const axios = require('axios');
const fs = require('fs');
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const puppeteer = require('puppeteer');
const chrome = require('chrome-aws-lambda');
const Handlebars = require('handlebars');

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    type: 'token',
    token: process.env.GITHUB_TOKEN
  },
});

module.exports = async (req, res) => {
    console.log("Function triggered!");
    try {
        const recordID = req.body.recordID;

        console.log(`Generating PDF for recordID: ${recordID}`);

        const html = fs.readFileSync('./template.html', 'utf8');
        const template = Handlebars.compile(html);
        const processedHTML = template(req.body || {});

        const browser = await puppeteer.launch({
            executablePath: await chrome.executablePath,
            args: chrome.args,
            defaultViewport: chrome.defaultViewport,
            headless: chrome.headless
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

        console.log("PDF uploaded to GitHub.");

        const fileURL = data.content.html_url;
        const airtableResponse = await axios.patch(process.env.AIRTABLE_API_URL, {
            fields: { 'PDF Attachment': [{ url: fileURL }] },
        }, {
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
        console.error('Error:', error);
        res.status(500).send(`Server Error: ${error.message}`);
    }
};
