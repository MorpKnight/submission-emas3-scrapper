// Load data on page load
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    loadStudents();
    loadFiles();
});

// Show toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

// Load config from server
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        document.getElementById('username').value = config.username || '';
        document.getElementById('password').value = config.password || '';
        document.getElementById('classUrl').value = config.classUrl || '';
        document.getElementById('submissionUrl').value = config.submissionUrl || '';
        document.getElementById('headless').checked = config.headless !== false;
    } catch (error) {
        showToast('Failed to load config', 'error');
    }
}

// Save config to server
async function saveConfig() {
    try {
        const config = {
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
            classUrl: document.getElementById('classUrl').value,
            submissionUrl: document.getElementById('submissionUrl').value,
            headless: document.getElementById('headless').checked,
        };

        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });

        const result = await res.json();
        showToast(result.message || 'Config saved!', 'success');
    } catch (error) {
        showToast('Failed to save config', 'error');
    }
}

// Load students from server
async function loadStudents() {
    try {
        const res = await fetch('/api/students');
        const data = await res.json();
        document.getElementById('students').value = data.students || '';
        updateStudentCount();
    } catch (error) {
        showToast('Failed to load students', 'error');
    }
}

// Save students to server
async function saveStudents() {
    try {
        const students = document.getElementById('students').value;

        const res = await fetch('/api/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ students }),
        });

        const result = await res.json();
        showToast(result.message || 'Students saved!', 'success');
        updateStudentCount();
    } catch (error) {
        showToast('Failed to save students', 'error');
    }
}

// Update student count badge
function updateStudentCount() {
    const students = document.getElementById('students').value;
    const count = students.split('\n').filter(l => l.trim()).length;
    document.getElementById('studentCount').textContent = `${count} students`;
}

// Listen for changes in students textarea
document.getElementById('students')?.addEventListener('input', updateStudentCount);

// Run scraper with live logs
async function runScraper() {
    const runBtn = document.getElementById('runBtn');
    const logContainer = document.getElementById('logContainer');

    runBtn.disabled = true;
    runBtn.innerHTML = '<span>⏳</span> Running...';

    logContainer.innerHTML = '';

    function addLog(message, type = '') {
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = message;
        logContainer.appendChild(line);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    addLog('Starting scraper...', 'warning');

    try {
        const eventSource = new EventSource('/api/run');

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'log') {
                let type = '';
                if (data.message.includes('✅')) type = 'success';
                else if (data.message.includes('❌') || data.message.includes('Error')) type = 'error';
                else if (data.message.includes('⚠️')) type = 'warning';

                addLog(data.message, type);
            } else if (data.type === 'error') {
                addLog(data.message, 'error');
            } else if (data.type === 'done') {
                addLog(`Process finished with code ${data.code}`, data.code === 0 ? 'success' : 'error');
                eventSource.close();

                runBtn.disabled = false;
                runBtn.innerHTML = '<span>▶️</span> Start Download';

                if (data.code === 0) {
                    showToast('Download completed!', 'success');
                    loadFiles(); // Refresh file list
                } else {
                    showToast('Scraper finished with errors', 'error');
                }
            }
        };

        eventSource.onerror = () => {
            addLog('Connection lost', 'error');
            eventSource.close();
            runBtn.disabled = false;
            runBtn.innerHTML = '<span>▶️</span> Start Download';
        };

    } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
        runBtn.disabled = false;
        runBtn.innerHTML = '<span>▶️</span> Start Download';
    }
}

// Load downloaded files
async function loadFiles() {
    const container = document.getElementById('filesContainer');

    try {
        const res = await fetch('/api/files');
        const data = await res.json();

        if (data.files.length === 0) {
            container.innerHTML = '<div class="log-placeholder">No files downloaded yet...</div>';
            return;
        }

        container.innerHTML = data.files.map(file => `
      <div class="file-item">
        <span class="file-icon">📄</span>
        <div class="file-info">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-meta">${file.sizeFormatted} • ${new Date(file.date).toLocaleString()}</div>
        </div>
        <div class="file-actions">
          <a href="${file.url}" download class="btn btn-primary btn-sm">
            <span>⬇️</span> Download
          </a>
          <button class="btn btn-danger btn-sm" onclick="deleteFile('${file.name}')">
            <span>🗑️</span>
          </button>
        </div>
      </div>
    `).join('');
    } catch (error) {
        container.innerHTML = '<div class="log-placeholder">Failed to load files</div>';
    }
}

// Delete a file
async function deleteFile(filename) {
    if (!confirm(`Delete "${filename}"?`)) return;

    try {
        const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
        });

        const result = await res.json();
        if (result.success) {
            showToast('File deleted', 'success');
            loadFiles();
        } else {
            showToast(result.error || 'Failed to delete', 'error');
        }
    } catch (error) {
        showToast('Failed to delete file', 'error');
    }
}
