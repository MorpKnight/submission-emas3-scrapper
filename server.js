const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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

// Get or create session
function getSession(req, res) {
    // Check header first, then query param (for SSE which can't send headers)
    let sessionId = req.headers['x-session-id'] || req.query.session;

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

    return { sessionId, session: sessions.get(sessionId) };
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve downloads per session
app.use('/downloads', (req, res, next) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        const sessionDownloadPath = path.join(__dirname, 'downloads', sessionId);
        express.static(sessionDownloadPath)(req, res, next);
    } else {
        res.status(401).json({ error: 'No session' });
    }
});

// API: Get session ID (called on page load)
app.get('/api/session', (req, res) => {
    const { sessionId } = getSession(req, res);
    res.json({ sessionId });
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
        const { session } = getSession(req, res);
        session.config = {
            username: req.body.username || '',
            password: req.body.password || '',
            classUrl: req.body.classUrl || '',
            submissionUrl: req.body.submissionUrl || '',
            headless: req.body.headless !== false,
        };
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
    const { sessionId, session } = getSession(req, res);

    // Check if already running
    if (session.isRunning) {
        res.status(400).json({ error: 'Scraper is already running for this session' });
        return;
    }

    // Validate config
    if (!session.config.username || !session.config.password || !session.config.submissionUrl) {
        res.status(400).json({ error: 'Please fill in all required config fields' });
        return;
    }

    if (!session.students.trim()) {
        res.status(400).json({ error: 'Please add at least one NPM to the list' });
        return;
    }

    session.isRunning = true;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);

    // Create session-specific download folder
    const sessionDownloadPath = path.join(__dirname, 'downloads', sessionId);
    if (!fs.existsSync(sessionDownloadPath)) {
        fs.mkdirSync(sessionDownloadPath, { recursive: true });
    }

    // Create temp config file for this session
    const tempConfigPath = path.join(__dirname, 'temp', `config-${sessionId}.json`);
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    fs.writeFileSync(tempConfigPath, JSON.stringify({
        ...session.config,
        students: session.students,
        downloadPath: sessionDownloadPath,
        loginUrl: 'https://emas3.ui.ac.id/login/index.php',
    }));

    const scraper = spawn('node', ['src/runner.js', tempConfigPath], { cwd: __dirname });

    scraper.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                res.write(`data: ${JSON.stringify({ type: 'log', message: line })}\n\n`);
            }
        });
    });

    scraper.stderr.on('data', (data) => {
        res.write(`data: ${JSON.stringify({ type: 'error', message: data.toString() })}\n\n`);
    });

    scraper.on('close', (code) => {
        session.isRunning = false;

        // Cleanup temp config
        try {
            fs.unlinkSync(tempConfigPath);
        } catch (e) { }

        res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
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
