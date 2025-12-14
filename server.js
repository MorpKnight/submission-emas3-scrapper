const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 3000;

// In-memory session storage (each user gets their own config)
const sessions = new Map();

// Session timeout (1 hour)
const SESSION_TIMEOUT = 60 * 60 * 1000;

// Cleanup expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastAccess > SESSION_TIMEOUT) {
            // Cleanup session downloads folder
            const sessionDownloadPath = path.join(__dirname, 'downloads', sessionId);
            if (fs.existsSync(sessionDownloadPath)) {
                fs.rmSync(sessionDownloadPath, { recursive: true, force: true });
            }
            sessions.delete(sessionId);
            console.log(`🧹 Session ${sessionId.slice(0, 8)}... expired and cleaned up`);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Get or create session (using cookies for better proxy compatibility)
function getSession(req, res) {
    // Check cookie first, then header, then query param
    let sessionId = req.cookies?.sessionId || req.headers['x-session-id'] || req.query.session;

    if (!sessionId || !sessions.has(sessionId)) {
        sessionId = uuidv4();
        sessions.set(sessionId, {
            config: {
                username: '',
                password: '',
                classUrl: '',
                submissionUrl: '',
                headless: true,
            },
            students: '',
            lastAccess: Date.now(),
            isRunning: false,
        });
        console.log(`🆕 New session created: ${sessionId.slice(0, 8)}...`);
    } else {
        sessions.get(sessionId).lastAccess = Date.now();
    }

    // Set cookie for future requests (works with SSE and proxies)
    if (res && !res.headersSent) {
        res.cookie('sessionId', sessionId, {
            httpOnly: false, // Allow JS access for debugging
            secure: false, // Set to true in production with HTTPS
            sameSite: 'lax',
            maxAge: SESSION_TIMEOUT,
        });
    }

    return { sessionId, session: sessions.get(sessionId) };
}

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve downloads per session
app.use('/downloads', (req, res, next) => {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'] || req.query.session;
    if (sessionId && sessions.has(sessionId)) {
        const sessionDownloadPath = path.join(__dirname, 'downloads', sessionId);
        express.static(sessionDownloadPath)(req, res, next);
    } else {
        res.status(401).json({ error: 'No session' });
    }
});

// API: Get session ID (called on page load)
app.get('/api/session', (req, res) => {
    // Check if client already has a session ID
    const clientSessionId = req.headers['x-session-id'] || req.query.session;

    // If client has valid session, return it; otherwise create new
    if (clientSessionId && sessions.has(clientSessionId)) {
        sessions.get(clientSessionId).lastAccess = Date.now();
        console.log(`📋 Session restored: ${clientSessionId.slice(0, 8)}...`);
        res.json({ sessionId: clientSessionId });
    } else {
        const { sessionId } = getSession(req, res);
        console.log(`📋 Session assigned: ${sessionId.slice(0, 8)}...`);
        res.json({ sessionId });
    }
});

// API: Get config
app.get('/api/config', (req, res) => {
    try {
        const { session } = getSession(req, res);
        res.json(session.config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Update config
app.post('/api/config', (req, res) => {
    try {
        const { sessionId, session } = getSession(req, res);
        session.config = {
            username: req.body.username || '',
            password: req.body.password || '',
            classUrl: req.body.classUrl || '',
            submissionUrl: req.body.submissionUrl || '',
            headless: req.body.headless !== false,
        };
        console.log(`💾 Config saved for session ${sessionId.slice(0, 8)}... (user: ${session.config.username})`);
        res.json({ success: true, message: 'Config saved!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get students
app.get('/api/students', (req, res) => {
    try {
        const { session } = getSession(req, res);
        res.json({ students: session.students });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Update students
app.post('/api/students', (req, res) => {
    try {
        const { session } = getSession(req, res);
        session.students = req.body.students || '';
        const count = session.students.split('\n').filter(l => l.trim()).length;
        res.json({ success: true, message: `Saved ${count} students` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Run scraper with SSE
app.get('/api/run', (req, res) => {
    // Always set SSE headers first
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { sessionId, session } = getSession(req, res);
    res.setHeader('X-Session-Id', sessionId);

    // Helper to send SSE message
    function sendSSE(type, message, code) {
        res.write(`data: ${JSON.stringify({ type, message, code })}\n\n`);
    }

    // Check if already running
    if (session.isRunning) {
        sendSSE('error', 'Scraper is already running for this session');
        sendSSE('done', null, 1);
        res.end();
        return;
    }

    // Validate config
    if (!session.config.username || !session.config.password || !session.config.submissionUrl) {
        sendSSE('error', '❌ Please fill in all required config fields (Username, Password, Submission URL)');
        sendSSE('done', null, 1);
        res.end();
        return;
    }

    if (!session.students.trim()) {
        sendSSE('error', '❌ Please add at least one NPM to the list');
        sendSSE('done', null, 1);
        res.end();
        return;
    }

    session.isRunning = true;
    sendSSE('log', '🔄 Preparing scraper...');

    // Create session-specific download folder
    const sessionDownloadPath = path.join(__dirname, 'downloads', sessionId);
    try {
        if (!fs.existsSync(sessionDownloadPath)) {
            fs.mkdirSync(sessionDownloadPath, { recursive: true });
        }
    } catch (e) {
        sendSSE('error', `❌ Failed to create download folder: ${e.message}`);
        sendSSE('done', null, 1);
        session.isRunning = false;
        res.end();
        return;
    }

    // Create temp config file for this session
    const tempDir = path.join(__dirname, 'temp');
    const tempConfigPath = path.join(tempDir, `config-${sessionId}.json`);

    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        fs.writeFileSync(tempConfigPath, JSON.stringify({
            ...session.config,
            students: session.students,
            downloadPath: sessionDownloadPath,
            loginUrl: 'https://emas3.ui.ac.id/login/index.php',
        }));
    } catch (e) {
        sendSSE('error', `❌ Failed to prepare config: ${e.message}`);
        sendSSE('done', null, 1);
        session.isRunning = false;
        res.end();
        return;
    }

    sendSSE('log', '🚀 Starting scraper process...');

    const scraper = spawn('node', ['src/runner.js', tempConfigPath], { cwd: __dirname });

    scraper.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                sendSSE('log', line);
            }
        });
    });

    scraper.stderr.on('data', (data) => {
        sendSSE('error', data.toString());
    });

    scraper.on('error', (error) => {
        sendSSE('error', `❌ Failed to start scraper: ${error.message}`);
        session.isRunning = false;
        sendSSE('done', null, 1);
        res.end();
    });

    scraper.on('close', (code) => {
        session.isRunning = false;

        // Cleanup temp config
        try {
            fs.unlinkSync(tempConfigPath);
        } catch (e) { }

        sendSSE('done', null, code);
        res.end();
    });

    req.on('close', () => {
        session.isRunning = false;
        scraper.kill();
        try {
            fs.unlinkSync(tempConfigPath);
        } catch (e) { }
    });
});

// API: List downloaded files (per session)
app.get('/api/files', (req, res) => {
    try {
        const { sessionId } = getSession(req, res);
        const sessionDownloadPath = path.join(__dirname, 'downloads', sessionId);

        if (!fs.existsSync(sessionDownloadPath)) {
            return res.json({ files: [] });
        }

        const files = fs.readdirSync(sessionDownloadPath).map(filename => {
            const filepath = path.join(sessionDownloadPath, filename);
            const stats = fs.statSync(filepath);
            return {
                name: filename,
                size: stats.size,
                sizeFormatted: formatBytes(stats.size),
                date: stats.mtime,
                url: `/downloads/${encodeURIComponent(filename)}`
            };
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Delete a file
app.delete('/api/files/:filename', (req, res) => {
    try {
        const { sessionId } = getSession(req, res);
        const filepath = path.join(__dirname, 'downloads', sessionId, req.params.filename);

        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ success: true, message: 'File deleted' });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper: Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global unhandled error handlers
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n📴 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 EMAS3 Dashboard running at http://localhost:${PORT}`);
    console.log('👥 Multi-user mode enabled - each user gets isolated sessions');
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
    } else {
        console.error('❌ Server error:', error.message);
    }
});
