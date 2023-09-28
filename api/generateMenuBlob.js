const axios = require('axios');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const Handlebars = require('handlebars');
const { put } = require('@vercel/blob'); // Add this
const qrcode = require('qrcode');

module.exports = async (req, res) => {
    try {
        const recordID = req.body.recordID;

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

        const processedHTML = template(dataForTemplate);;

        const browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
        });

        const page = await browser.newPage();
        await page.setContent(processedHTML);


       
        // Now, generate the PDF as a buffer
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
    
        // Upload to Vercel Blob
        const pdfName = `PDFs/${recordID}.pdf`;
        const blob = await put(pdfName, pdf, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN
        });
    
        console.log("PDF uploaded to Vercel Blob.");
    
        // If you'd like to retain the functionality of updating Airtable with a URL, you can do so using the blob's URL
        const fileURL = blob.url;
        const airtableEndpoint = `https://api.airtable.com/v0/appwLqFINlFj1m52k/tbl8i6G1qTReEtT89/${recordID}`;
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
