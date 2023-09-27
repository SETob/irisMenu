const axios = require('axios');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const Handlebars = require('handlebars');
const { Blob } = require('@vercel/blob'); // Add this

module.exports = async (req, res) => {
    try {
        const recordID = req.body.recordID;

        console.log(`Generating PDF for recordID: ${recordID}`);
        console.log("Received data:", JSON.stringify(req.body));


        const templatePath = require('path');
        const htmlPath = templatePath.resolve(__dirname, '..', 'templates', 'menuTemplate.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        const template = Handlebars.compile(html);
        const processedHTML = template(req.body || {});

        const browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
        });

        const page = await browser.newPage();
        await page.setContent(processedHTML);


       
        // Now, generate the PDF as a buffer
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 }
        });

        await browser.close();

        // Convert the buffer to a readable stream
        const readableStream = require('stream').Readable.from(pdfBuffer);

        // Upload the PDF to Vercel Blob storage
        const blob = new Blob();
        console.log("Attempting to upload PDF to Vercel Blob.");

        const result = await blob.put(`menus/${recordID}.pdf`, readableStream, {
            access: 'public',
            contentType: 'application/pdf',
            addRandomSuffix: false
        });
        console.log("Successfully uploaded PDF to Vercel Blob. URL:", blobResponse.url);


        console.log("PDF uploaded to Vercel Blob storage.");

        const airtableEndpoint = `https://api.airtable.com/v0/appwLqFINlFj1m52k/tbl8i6G1qTReEtT89/${recordID}`;
        const fileURL = result.url;
        const filename = `menu_${Date.now()}.pdf`;

        const patchData = {
            fields: {
                'Menu': [
                    {
                        "url": fileURL,
                        "filename": filename
                    }
                ]
            }
        };

        // ... [rest of your code for updating Airtable] ...
    } catch (error) {
        // ... [your error handling logic] ...
    }
}
