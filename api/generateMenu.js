const axios = require('axios');
const fs = require('fs');
const { Octokit } = require("@octokit/rest");
const puppeteer = require('puppeteer-core');
const Handlebars = require('handlebars');
const qrcode = require('qrcode');

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

module.exports = async (req, res) => {
    try {
        const recordID = req.body.recordID;
        const slug = req.body.slug;

        console.log(`Generating PDF for recordID: ${recordID}`);
        console.log("Received data:", JSON.stringify(req.body));


        const templatePath = require('path');
        const htmlPath = templatePath.resolve(__dirname, '..', 'templates', 'menuTemplate.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        const template = Handlebars.compile(html);

        const fullURL = `https://www.restaurantiris.no/journeys/${slug}`;

        const qrCodeURI = await qrcode.toDataURL(fullURL, { type: 'png', size: 6});
        const dataForTemplate = {
            ...req.body,
            qrCodeURL: qrCodeURI
        };

        const processedHTML = template(dataForTemplate);

        const browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
        });

        const page = await browser.newPage();
        await page.setContent(processedHTML);


        // Ensure QR Code is present in the DOM
        await page.waitForSelector('.qrCode');

        // Ensure QR Code is fully loaded
        await page.waitForFunction(() => {
            const qrImage = document.querySelector('.qrCode');
            return qrImage.complete;
        });

        // Now, generate the PDF
        const pdfPath = `/tmp/${recordID}.pdf`;
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            landscape: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 }
        });

        await browser.close();

        const pdf = fs.readFileSync(pdfPath);
        console.log("PDF generated and read into memory.");

        const owner = process.env.GITHUB_USERNAME;
        const repo = process.env.GITHUB_REPO;
        const path = `PDFs/${recordID}.pdf`;

        const { data } = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path,
            message: 'PDF added',
            content: pdf.toString('base64'),
        });


        console.log("PDF uploaded to GitHub.");
        const airtableEndpoint = `https://api.airtable.com/v0/appwLqFINlFj1m52k/tbl8i6G1qTReEtT89/${recordID}`;
        const fileURL = data.content.download_url;
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


        const airtableResponse = await axios.patch(airtableEndpoint, patchData, {
            headers: {
                'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json',
            }
        });

        if (airtableResponse.status === 200) {
            await octokit.rest.repos.deleteFile({
                owner,
                repo,
                path,
                message: 'PDF deleted after upload to Airtable',
                sha: data.content.sha,
            });
            console.log("PDF uploaded to Airtable and deleted from GitHub.");
            res.status(200).send('PDF uploaded to Airtable and deleted from GitHub');
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