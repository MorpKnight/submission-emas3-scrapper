const { wait } = require('./browser');

/**
 * Scroll to top and trigger download via Grading action dropdown
 */
async function downloadSubmissions(page) {
    console.log('⬆️ Scrolling to grading action section...');

    // Set up dialog handler for OK/Cancel confirmation popups
    page.on('dialog', async (dialog) => {
        console.log(`📢 Dialog appeared: "${dialog.message()}"`);
        console.log('✅ Clicking OK on dialog...');
        await dialog.accept();
    });

    // Scroll to top where the Grading action dropdown is
    await page.evaluate(() => {
        window.scrollTo(0, 0);
    });

    await wait(300); // Reduced from 1000

    console.log('🔍 Looking for Grading action dropdown...');

    // Find the Grading action dropdown and select "Download selected submissions"
    const dropdownFound = await page.evaluate(() => {
        const selects = document.querySelectorAll('select');

        for (const select of selects) {
            const options = select.querySelectorAll('option');
            for (const option of options) {
                const text = option.textContent.toLowerCase();
                if (text.includes('download') && text.includes('selected')) {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return {
                        found: true,
                        value: option.textContent.trim(),
                        selectId: select.id || select.name || 'unknown'
                    };
                }
            }
        }

        // Fallback: try to find any download option
        for (const select of selects) {
            const options = select.querySelectorAll('option');
            for (const option of options) {
                const text = option.textContent.toLowerCase();
                if (text.includes('download')) {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return {
                        found: true,
                        value: option.textContent.trim(),
                        selectId: select.id || select.name || 'unknown'
                    };
                }
            }
        }

        return { found: false };
    });

    if (dropdownFound.found) {
        console.log(`✅ Selected: "${dropdownFound.value}" from dropdown ${dropdownFound.selectId}`);
    } else {
        console.log('❌ Grading action dropdown not found');
        return false;
    }

    await wait(200); // Reduced from 500

    // Click the Submit/Go button next to the dropdown
    console.log('🔘 Looking for Submit button...');

    const submitClicked = await page.evaluate(() => {
        const submitButton =
            document.querySelector('input[type="submit"][value="Go"]') ||
            document.querySelector('input[type="submit"][value="Submit"]') ||
            document.querySelector('button[type="submit"]') ||
            document.querySelector('input.btn[type="submit"]') ||
            document.querySelector('#id_submitbutton') ||
            document.querySelector('.gradingbatchoperationsform input[type="submit"]') ||
            document.querySelector('form input[type="submit"]');

        if (submitButton) {
            submitButton.click();
            return { clicked: true, value: submitButton.value || submitButton.textContent };
        }

        return { clicked: false };
    });

    if (submitClicked.clicked) {
        console.log(`✅ Clicked Submit button: "${submitClicked.value}"`);
    } else {
        console.log('⚠️ Submit button not found, trying form submission...');

        const formSubmitted = await page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) {
                form.submit();
                return true;
            }
            return false;
        });

        if (!formSubmitted) {
            console.log('❌ Could not submit form');
            return false;
        }
    }

    // Wait for dialog and download to initialize
    console.log('⏳ Waiting for confirmation and download...');
    await wait(1500); // Reduced from 3000

    // Also check for modal confirmation dialogs (Bootstrap modals)
    const modalHandled = await page.evaluate(() => {
        const confirmBtn = document.querySelector('.modal-footer .btn-primary, .modal .btn-primary, button.btn-primary');
        if (confirmBtn) {
            confirmBtn.click();
            return true;
        }
        return false;
    });

    if (modalHandled) {
        console.log('✅ Modal confirmation handled');
    }

    await wait(2000); // Reduced from 5000

    console.log('✅ Download process completed');
    return true;
}

/**
 * Alternative: Download all submissions at once
 */
async function downloadAllSubmissions(page) {
    console.log('📥 Looking for "Download all submissions" link...');

    page.on('dialog', async (dialog) => {
        console.log(`📢 Dialog: "${dialog.message()}"`);
        await dialog.accept();
    });

    const linkClicked = await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
            if (link.textContent.toLowerCase().includes('download all')) {
                link.click();
                return true;
            }
        }
        return false;
    });

    if (linkClicked) {
        console.log('✅ Clicked "Download all submissions" link');
        await wait(2000);
        return true;
    }

    console.log('⚠️ "Download all" link not found');
    return false;
}

module.exports = {
    downloadSubmissions,
    downloadAllSubmissions,
};
