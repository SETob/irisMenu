const express = require('express');
const axios = require('axios');
const fs = require('fs');
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const puppeteer = require('puppeteer');
const chrome = require('chrome-aws-lambda');
const Handlebars = require('handlebars');

const app = express();
app.use(express.json());

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    type: 'token',
    token: process.env.GITHUB_TOKEN
  },
});

app.post('/generatePDF', async (req, res) => {
    try {
        const recordID = req.body.recordID;

        // The HTML template
        const html = fs.readFileSync('./template.html', 'utf8');

        // Using Handlebars to insert the data into the template
        const template = Handlebars.compile(html);
        const processedHTML = template(req.body || {});

        // Using Puppeteer to generate the PDF
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

        // Repository Information
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
            res.status(200).send('PDF uploaded to Airtable and deleted from GitHub');
        } else {
            res.status(400).send('Failed to upload PDF to Airtable');
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Server Error');
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server is running on port ${port}`));
