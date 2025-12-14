const { launchBrowser, closeBrowser, wait } = require('./browser');
const { login } = require('./auth');
const {
    readStudentList,
    navigateToSubmission,
    selectStudents,
} = require('./scraper');
const { downloadSubmissions } = require('./downloader');

async function main() {
    console.log('🚀 Starting EMAS3 Scraper...\n');

    let page = null;
    let browser = null;

    try {
        // Step 1: Launch browser
        page = await launchBrowser();

        // Step 2: Login
        await login(page);

        // Step 3: Navigate directly to submission page
        await navigateToSubmission(page);

        // Step 4: Read student list
        const npmList = readStudentList();

        if (npmList.length === 0) {
            console.log('⚠️ No students in list. Please add NPM to student.txt');
            return;
        }

        // Step 5: Select students by NPM
        await selectStudents(page, npmList);

        // Step 6: Scroll down and download
        await downloadSubmissions(page);

        console.log('\n🎉 Process completed successfully!');
        console.log('📁 Check the downloads folder for your files.');

        // Brief wait to see the result
        await wait(2000);

    } catch (error) {
        console.error('\n❌ Error:', error.message);

        // Don't expose full stack trace in production
        if (process.env.NODE_ENV !== 'production') {
            console.error(error.stack);
        }
    } finally {
        // Always try to close browser
        try {
            await closeBrowser();
        } catch (e) {
            console.error('⚠️ Error closing browser:', e.message);
        }
    }
}

// Global unhandled error handlers
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    closeBrowser().catch(() => { });
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    closeBrowser().catch(() => { });
});

// Run the main function
main().catch((error) => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
