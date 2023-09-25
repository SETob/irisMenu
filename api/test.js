module.exports = (req, res) => {
    // Log the request body (which should contain the JSON from Airtable)
    console.log(req.body);

    // Respond with a simple message to acknowledge receipt of the data
    res.status(200).send('Data received and logged.');
}
