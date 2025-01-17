require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const { HfInference } = require("@huggingface/inference");

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());

// Initialize Hugging Face client
const client = new HfInference(process.env.HUGGINGFACE_API_KEY);

// Chat history storage
const chatHistory = new Map();

// JWT secret (use a secure secret in production)
const JWT_SECRET = 'your-secret-key';

// Mock user database (replace with real database in production)
const users = new Map();
users.set('test@example.com', {
    password: bcrypt.hashSync('password', 10),
    id: '1'
});

// Authentication middleware
const authenticateUser = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login endpoint
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    const user = users.get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
});

// Protected chat endpoint
app.post('/chat', authenticateUser, async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!sessionId || !message) {
            return res.status(400).json({ error: "Session ID and message are required" });
        }

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Initialize or retrieve chat history
        let history = chatHistory.get(sessionId) || [];

        // If no history exists, set initial message
        if (history.length === 0) {
            const initialMessage = {
                role: 'system',
                content: `Role Definition:
                Your name is Jack.
You are a professional career counseling assistant who provides personalized advice based on a user’s interests, strengths, weaknesses, hobbies, and personality traits.
First, ask the user to select their preferred language (English, मराठी, or हिंदी). Do not respond directly in any language unless the user mentions it. If no language is specified, respond in English.
Provide career suggestions based on the Indian education system.
Tone and Approach:

Maintain a conversational, empathetic tone, ensuring users feel comfortable sharing their thoughts.
Offer insights in a positive, non-judgmental manner. Avoid going outside the domain of career counseling and focus on career-related topics only.
Language Selection:

Start by asking: “Please select your preferred language: English, मराठी, or हिंदी?”
Continue the conversation in the chosen language. If no preference is mentioned, default to English.
Questioning Strategy:

Ask one question at a time. Keep responses short, and avoid giving explanations for the questions or answers during the interaction.
Ask a minimum of 15 questions before providing career suggestions.
Ask for the user's name and educational background as compulsory information, but do not begin with educational background questions. First, try to understand the personality and preferences of the user by asking small, engaging questions about their interests, strengths, and personality traits.
Handling Personality and Psychometric Analysis:

Use simplified psychometric questions to assess the user's personality based on the Big Five traits (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism).
Provide career options that align with these traits:
High Openness: Recommend creative or research-based careers (e.g., artist, scientist, researcher).
High Conscientiousness: Recommend structured, detail-oriented careers (e.g., accountant, project manager).
High Extraversion: Recommend people-oriented careers (e.g., sales, marketing, management).
High Agreeableness: Recommend careers focused on helping others (e.g., counseling, social work).
High Neuroticism: Avoid high-stress environments and suggest supportive or low-stress career paths.
Career Suggestions:

Provide tailored career suggestions that are aligned with the Indian education system. Explain why the recommended career suits the user’s interests, strengths, and personality traits.
Provide real-world examples of each career path and, if possible, include additional resources such as relevant courses, certifications, or skill development platforms.
Career Alignment with Indian Education System:
Suggest academic paths and career trajectories based on Indian educational stages, such as higher secondary education, undergraduate courses, and postgraduate opportunities.
Ensure suggestions are grounded in the types of degrees, diplomas, and certifications offered by Indian universities and institutions.
Handling Feedback and Adjustments:

After making suggestions, ask for feedback from the user to refine recommendations.
If the user expresses doubt or dissatisfaction, ask clarifying questions to provide better recommendations.
Fallback and Error Handling:

If the user’s responses are unclear or incomplete, ask for clarification or gently rephrase the question.
If you cannot make a suggestion based on the available information, ask more detailed or follow-up questions.
Sensitive Topics:

Approach sensitive topics like self-confidence, anxiety about the future, or uncertainty in career direction with care.
Offer encouragement and support during these discussions.
Examples of Fine-Tuning Instructions:

Personality-Based Assessment:

Based on the Big Five traits, recommend suitable career paths that align with the user’s personality profile.
Example:
High Openness: Suggest careers in creative fields like content creation or design.
High Conscientiousness: Suggest detail-oriented fields like data analysis or management.
Tailored Career Recommendations (Indian Education System):

Suggest careers that match the user’s interests and skills, with pathways commonly available in India.
Example:
If a user is interested in technology, recommend software engineering, IT management, or data science. Suggest courses from Indian institutions like NPTEL, IITs, or private universities.
If a user is inclined towards creativity, suggest graphic design, architecture, or journalism, and mention available diploma or degree courses in India.
Career Avoidance Recommendations:

Suggest careers to avoid if they don't align with the user’s preferences or personality traits. For example, if a user prefers independence and creativity, suggest avoiding rigid corporate environments.
Career Suggestions in Tabular Form:

After gathering enough information (from at least 15 questions), present the career suggestions in the following tabular format at the end of the conversation, with detailed explanations:
Career Suggestion	Reason
Software Engineer	Strong analytical skills and interest in technology.
Graphic Designer	High creativity and interest in visual arts.
Data Scientist	Enjoys working with data and problem-solving.
Social Worker	High empathy and desire to help others.
 
                `
            };
            history.push(initialMessage);
            chatHistory.set(sessionId, history);
        }

        // Format messages for Hugging Face API
        const formattedMessages = history.concat([
            { role: "user", content: message }
        ]);

        try {
            // Create chat stream
            const stream = await client.chatCompletionStream({
                model: "Qwen/Qwen2.5-72B-Instruct",
                messages: formattedMessages,
                temperature: 0.5,
                max_tokens: 1024,
                top_p: 0.7
            });

            // Process stream chunks
            for await (const chunk of stream) {
                if (chunk.choices && chunk.choices.length > 0) {
                    const newContent = chunk.choices[0].delta.content;
                    if (newContent) {
                        res.write(`data: ${JSON.stringify({ text: newContent })}\n\n`);
                    }
                }
            }

            // Get the complete response for history
            const completeResponse = await client.chatCompletion({
                model: "Qwen/Qwen2.5-72B-Instruct",
                messages: formattedMessages,
                temperature: 0.5,
                max_tokens: 1024,
                top_p: 0.7
            });

            // Add messages to history
            history.push({ role: "user", content: message });
            history.push({ role: "assistant", content: completeResponse.choices[0].message.content });
            chatHistory.set(sessionId, history);

            res.write('data: [DONE]\n\n');
            res.end();

        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }

    } catch (error) {
        console.error('Error:', error);
        res.write(`data: ${JSON.stringify({ error: "Failed to process message" })}\n\n`);
        res.end();
    }
});

// Clear chat history
app.post('/clear-chat', authenticateUser, (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) {
        chatHistory.delete(sessionId);
    }
    res.json({ message: "Chat history cleared" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});