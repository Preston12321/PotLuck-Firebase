const functions = require('firebase-functions');
const axios = require('axios').default;

exports.testRecipesByIngredients = functions.https.onRequest(async (request, response) => {

    // Only accept GET requests
    if (request.method === 'GET') {
        // Fetch api key from environment variable
        var apiKey = functions.config().spoonacular.key;
        
        try {
            // Call Spoonacular API findByIngredients endpoint
            var res = await axios.get('https://api.spoonacular.com/recipes/findByIngredients',{
                params: {
                    // Always need to pass in api key for authentication
                    apiKey: apiKey,
    
                    // Comma-separated list of ingredients that the recipes should contain
                    ingredients: request.query.ingredients,
    
                    // Recipes should have an open license that allows display with proper attribution
                    limitLicense: true,
    
                    // Maximize used ingredients (1) or minimize missing ingredients (2)
                    ranking: 1,
    
                    // Ignore typical pantry items, such as water, salt, flour, etc.
                    ignorePantry: true
                }
            });
            // If call was successful, return results directly
            response.send(res.data);
        }
        catch (error) {
            // Return error-specific message if one exists
            if (error.response) {
                // Obviously in production, this could be insecure
                response.status(error.response.status).send(error.response.data);
            }
            else {
                response.status(500).send('Server error, sorry!');
            }
        }
    }
    else {
        // Send an error 405 [Method Not Allowed] response code
        response.status(405).send('GET request expected');
    }
});
