const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Config file path
const configPath = path.join(__dirname, 'src', 'config.js');
const studentPath = path.join(__dirname, 'data', 'student.txt');

// Helper: Read current config
function getConfig() {
    delete require.cache[require.resolve('./src/config')];
    return require('./src/config');
}

// Helper: Update config file
function updateConfig(newConfig) {
    const configContent = `const path = require('path');

module.exports = {
  // Credentials
  username: '${newConfig.username}',
  password: '${newConfig.password}',

  // URLs
  loginUrl: 'https://emas3.ui.ac.id/login/index.php',
  classUrl: '${newConfig.classUrl}',
  submissionUrl: '${newConfig.submissionUrl}',

  // Paths
  studentListPath: path.join(__dirname, '..', 'data', 'student.txt'),
  downloadPath: path.join(__dirname, '..', 'downloads'),

  // Browser settings
  headless: ${newConfig.headless},
  slowMo: 0,
};
`;
    fs.writeFileSync(configPath, configContent);
}

// API: Get config
app.get('/api/config', (req, res) => {
    try {
        const config = getConfig();
        res.json({
            username: config.username,
            password: config.password,
            classUrl: config.classUrl,
            submissionUrl: config.submissionUrl,
            headless: config.headless,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Update config
app.post('/api/config', (req, res) => {
    try {
        const config = getConfig();
        const newConfig = {
            username: req.body.username || config.username,
            password: req.body.password || config.password,
            classUrl: req.body.classUrl || config.classUrl,
            submissionUrl: req.body.submissionUrl || config.submissionUrl,
            headless: req.body.headless !== undefined ? req.body.headless : config.headless,
        };
        updateConfig(newConfig);
        res.json({ success: true, message: 'Config updated!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get students
app.get('/api/students', (req, res) => {
    try {
        const content = fs.existsSync(studentPath)
            ? fs.readFileSync(studentPath, 'utf-8')
            : '';
        res.json({ students: content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Update students
app.post('/api/students', (req, res) => {
    try {
        fs.writeFileSync(studentPath, req.body.students || '');
        const count = req.body.students.split('\n').filter(l => l.trim()).length;
        res.json({ success: true, message: `Saved ${count} students` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Run scraper with SSE
app.get('/api/run', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const scraper = spawn('node', ['src/index.js'], { cwd: __dirname });

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
        res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
        res.end();
    });

    req.on('close', () => {
        scraper.kill();
    });
});

// Downloads folder path
const downloadsPath = path.join(__dirname, 'downloads');

// Serve downloads folder for direct file access
app.use('/downloads', express.static(downloadsPath));

// API: List downloaded files
app.get('/api/files', (req, res) => {
    try {
        if (!fs.existsSync(downloadsPath)) {
            return res.json({ files: [] });
        }

        const files = fs.readdirSync(downloadsPath).map(filename => {
            const filepath = path.join(downloadsPath, filename);
            const stats = fs.statSync(filepath);
            return {
                name: filename,
                size: stats.size,
                sizeFormatted: formatBytes(stats.size),
                date: stats.mtime,
                url: `/downloads/${encodeURIComponent(filename)}`
            };
        }).sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first

        res.json({ files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Delete a file
app.delete('/api/files/:filename', (req, res) => {
    try {
        const filepath = path.join(downloadsPath, req.params.filename);
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
    // Don't crash the server
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    // Don't crash the server
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
});

// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
    } else {
        console.error('❌ Server error:', error.message);
    }
});
