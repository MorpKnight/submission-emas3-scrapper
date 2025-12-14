const path = require('path');

module.exports = {
  // Credentials
  username: '',
  password: '',

  // URLs
  loginUrl: 'https://emas3.ui.ac.id/login/index.php',
  classUrl: '',
  submissionUrl: '',

  // Paths
  studentListPath: path.join(__dirname, '..', 'data', 'student.txt'),
  downloadPath: path.join(__dirname, '..', 'downloads'),

  // Browser settings
  headless: true,
  slowMo: 0,
};
