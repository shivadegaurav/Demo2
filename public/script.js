document.addEventListener('DOMContentLoaded', () => {
    // Check if user is not logged in and redirect to login page
    const token = localStorage.getItem('token');
    if (!token && window.location.pathname !== '/login.html') {
        window.location.href = '/login.html';
        return;
    }

    const chatLog = document.getElementById('chat-log');
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const clearChatBtn = document.getElementById('clear-chat');
    const saveChatBtn = document.getElementById('save-chat');
    const toggleThemeBtn = document.getElementById('toggle-theme');
    const buttonText = sendButton.querySelector('.button-text');
    const loadingSpinner = sendButton.querySelector('.loading-spinner');
    
    const converter = new showdown.Converter();
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    // Initialize theme from localStorage
    if (localStorage.getItem('darkTheme') === 'true') {
        document.body.classList.add('dark-theme');
    }

    chatForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = userInput.value.trim();
        if (!message) return;

        addMessageToChatLog('You', message, 'user-message');
        userInput.value = '';
        userInput.disabled = true;

        buttonText.style.display = 'none';
        loadingSpinner.style.display = 'block';
        sendButton.disabled = true;

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ message, sessionId }),
            });

            if (response.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let botMessage = '';
            const messageElement = document.createElement('div');
            messageElement.className = 'message bot-message';
            messageElement.innerHTML = '<strong>Bot:</strong> ';
            chatLog.appendChild(messageElement);

            const replyContainer = document.createElement('span');
            messageElement.appendChild(replyContainer);

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const content = line.slice(6).trim();
                        
                        if (content === '[DONE]') break;
                        
                        try {
                            const data = JSON.parse(content);
                            botMessage += data.text;
                            replyContainer.innerHTML = converter.makeHtml(botMessage);
                            
                            // Apply syntax highlighting to code blocks
                            messageElement.querySelectorAll('pre code').forEach((block) => {
                                hljs.highlightBlock(block);
                            });
                            
                            chatLog.scrollTop = chatLog.scrollHeight;
                        } catch (parseError) {
                            console.warn('Failed to parse chunk:', content);
                            continue;
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error:', error);
            addMessageToChatLog('Bot', 'Sorry, an error occurred while processing your request. Please try again.', 'bot-message error');
        } finally {
            buttonText.style.display = 'block';
            loadingSpinner.style.display = 'none';
            sendButton.disabled = false;
            userInput.disabled = false;
            userInput.focus();
        }
    });

    function addMessageToChatLog(sender, message, className) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${className}`;
        
        let formattedMessage = converter.makeHtml(message);
        formattedMessage = formattedMessage.replace(/<pre><code>/g, '<pre><code class="hljs">');
        
        messageElement.innerHTML = `<strong>${sender}:</strong> ${formattedMessage}`;
        chatLog.appendChild(messageElement);
        chatLog.scrollTop = chatLog.scrollHeight;

        messageElement.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightBlock(block);
        });
    }

    clearChatBtn?.addEventListener('click', async () => {
        const confirmed = confirm('Are you sure you want to clear the chat history?');
        if (!confirmed) return;

        chatLog.innerHTML = '';
        try {
            const response = await fetch('/clear-chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ sessionId }),
            });

            if (response.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) {
                throw new Error('Failed to clear chat history on server');
            }
        } catch (error) {
            console.error('Error clearing chat history:', error);
            addMessageToChatLog('System', 'Failed to clear chat history on server. Please try again.', 'bot-message error');
        }
    });

    saveChatBtn?.addEventListener('click', () => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const chatContent = chatLog.innerHTML;
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Chat History - ${timestamp}</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
                    .message { margin-bottom: 1rem; padding: 1rem; border-radius: 0.5rem; }
                    .user-message { background-color: #e9ecef; margin-left: 2rem; }
                    .bot-message { background-color: #f8f9fa; margin-right: 2rem; }
                    pre { background-color: #f8f9fa; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
                    code { font-family: monospace; }
                </style>
            </head>
            <body>
                <h1>Chat History</h1>
                <p>Saved on: ${new Date().toLocaleString()}</p>
                <div class="chat-log">
                    ${chatContent}
                </div>
            </body>
            </html>
        `;
        
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chat-history-${timestamp}.html`;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    toggleThemeBtn?.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('darkTheme', document.body.classList.contains('dark-theme'));
    });

    // Handle input field
    userInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendButton.disabled) {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Focus input field on load
    userInput?.focus();
});