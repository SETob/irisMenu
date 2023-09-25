const axios = require('axios');
const fs = require('fs');
const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const puppeteer = require('puppeteer');
const chrome = require('chrome-aws-lambda');
const Handlebars = require('handlebars');


const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

  

module.exports = async (req, res) => {
    try {
        const recordID = req.body.recordID;

        console.log(`Generating PDF for recordID: ${recordID}`);

        const templatePath = require('path');
        const htmlPath = templatePath.resolve(__dirname, '..', 'template.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        const template = Handlebars.compile(html);
        const processedHTML = template(req.body || {});

        let browser;
        if (process.env.NODE_ENV === "production") {
            browser = await puppeteer.launch({
                executablePath: await chrome.executablePath,
                args: chrome.args,
                defaultViewport: chrome.defaultViewport,
                headless: chrome.headless
            });
        } else {
            browser = await puppeteer.launch();
        }
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
        const airtableEndpoint = `${process.env.AIRTABLE_API_URL}/${recordID}`;
        const fileURL = data.content.download_url;
        const filename = `wineMenu_${Date.now()}.pdf`;

        console.log(airtableEndpoint);
        console.log(filename);
        console.log(fileURL);

        const patchData = {
            fields: {
                'wineMenuFile': [
                    {
                        "url": fileURL,
                        "filename": filename
                    }
                ]
            }
        };

        console.log("Sending to AT:", JSON.stringify(patchData, null, 2));

        const airtableResponse = await axios.patch(airtableEndpoint,  patchData, {
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

