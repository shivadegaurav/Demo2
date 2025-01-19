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
    id: '1',
    name: 'Test User',
    email: 'test@example.com',
    password: bcrypt.hashSync('password', 10)
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

    const token = jwt.sign({ id: user.id, email, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// Register endpoint
app.post('/auth/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (users.has(email)) {
        return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const userId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    const newUser = {
        id: userId,
        name,
        email,
        password: hashedPassword
    };
    
    users.set(email, newUser);

    const token = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, user: { id: userId, email, name } });
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
                content: `Role Definition: [Your existing system message content]`
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