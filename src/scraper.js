const fs = require('fs');
const config = require('./config');
const { wait } = require('./browser');

/**
 * Read student NPM list from file
 */
function readStudentList() {
    if (!fs.existsSync(config.studentListPath)) {
        throw new Error(`Student list not found at: ${config.studentListPath}`);
    }

    const content = fs.readFileSync(config.studentListPath, 'utf-8');
    const npmList = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    console.log(`📋 Loaded ${npmList.length} students from list`);
    return npmList;
}

/**
 * Navigate to class page
 */
async function navigateToClass(page) {
    console.log('📚 Navigating to class page...');
    await page.goto(config.classUrl, { waitUntil: 'networkidle2' });
    console.log('✅ Class page loaded');
}

/**
 * Navigate to submission page
 */
async function navigateToSubmission(page) {
    console.log('📝 Navigating to submission page...');
    await page.goto(config.submissionUrl, { waitUntil: 'networkidle2' });
    await wait(500); // Reduced from 1000
    console.log('✅ Submission page loaded');
}

/**
 * Select students by checking their checkboxes
 */
async function selectStudents(page, npmList) {
    console.log('🔍 Looking for student checkboxes...');

    // Select all students in one go using evaluate
    const result = await page.evaluate((npmsToFind) => {
        let selectedCount = 0;
        const notFound = [];

        // Find all rows in the grading table
        const rows = document.querySelectorAll('table tbody tr');

        for (const npm of npmsToFind) {
            let found = false;
            for (const row of rows) {
                if (row.textContent.includes(npm)) {
                    const checkbox = row.querySelector('input[type="checkbox"]');
                    if (checkbox && !checkbox.checked) {
                        checkbox.click();
                    }
                    found = true;
                    selectedCount++;
                    break;
                }
            }
            if (!found) {
                notFound.push(npm);
            }
        }

        return { selectedCount, notFound, total: npmsToFind.length };
    }, npmList);

    // Log results
    console.log(`📊 Selected ${result.selectedCount}/${result.total} students`);
    if (result.notFound.length > 0) {
        console.log(`⚠️ Not found: ${result.notFound.join(', ')}`);
    }

    return result.selectedCount;
}

/**
 * Select all students using the "select all" checkbox if available
 */
async function selectAllStudents(page) {
    console.log('🔍 Looking for "Select All" checkbox...');

    const found = await page.evaluate(() => {
        const selectAll = document.querySelector('input[name="selectall"]') ||
            document.querySelector('th input[type="checkbox"]') ||
            document.querySelector('.selectall input[type="checkbox"]');
        if (selectAll) {
            selectAll.click();
            return true;
        }
        return false;
    });

    if (found) {
        console.log('✅ Selected all students');
    } else {
        console.log('⚠️ "Select All" checkbox not found');
    }

    return found;
}

module.exports = {
    readStudentList,
    navigateToClass,
    navigateToSubmission,
    selectStudents,
    selectAllStudents,
};
