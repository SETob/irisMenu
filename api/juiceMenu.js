const axios = require('axios');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const Handlebars = require('handlebars');
const { put } = require('@vercel/blob');

module.exports = async (req, res) => {
    try {
        const { recordID, date } = req.body;
        console.log(`Generating PDF for recordID: ${recordID}`);

        const templatePath = require('path');
        const htmlPath = templatePath.resolve(__dirname, '..', 'templates', 'juiceMenuTemplate.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        const template = Handlebars.compile(html);
        const processedHTML = template(req.body || {});

        const browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
        });


        const page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const blockResources = ['stylesheet', 'font', 'script'];
            if (blockResources.includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        await page.setContent(processedHTML);

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.images).map(img => img.complete ? null : new Promise(resolve => img.onload = resolve));
            await Promise.all(selectors);
        });

        // Generate the PDF as a buffer
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 }
        });

        await browser.close();
        console.log("PDF generated and stored in memory.");

        // Upload the buffer to Vercel Blob
        const pdfName = `PDFs/${recordID}.pdf`;
        const blobPromise = await put(pdfName, pdfBuffer, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN
        });

        console.log("PDF uploaded to Vercel Blob.");

        const blob = await blobPromise;

        const airtableEndpoint = `https://api.airtable.com/v0/app9qiUBEDVJBPxhc/tblNsaowMSGvd26ZS/${recordID}`;
        const fileURL = blob.url;
        const filename = `juiceMenu_${date}.pdf`;

        const patchData = {
            fields: {
                'juiceMenuFile': [
                    {
                        "url": fileURL,
                        "filename": filename
                    }
                ]
            }
        };

        console.log("Sending to AT:", JSON.stringify(patchData, null, 2));

        const airtableResponse = await axios.patch(airtableEndpoint, patchData, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json',
            }
        });

        if (airtableResponse.status === 200) {
            console.log("PDF uploaded to Airtable.");
            res.status(200).send('PDF uploaded to Airtable');
        } else {
            console.error("Failed to upload PDF to Airtable.");
            res.status(400).send('Failed to upload PDF to Airtable');
        }
    } catch (error) {
        console.error('Error Message:', error.message);
        console.error('Error Stack:', error.stack);
        res.status(500).send('Server Error');
    }
}
