const axios = require('axios');
const fs = require('fs');
const { Octokit } = require("@octokit/rest");
const puppeteer = require('puppeteer-core');
const Handlebars = require('handlebars');

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

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

        console.log("GitHub Response:", JSON.stringify(data, null, 2));

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

        console.log("Sending to AT:", JSON.stringify(patchData, null, 2));

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