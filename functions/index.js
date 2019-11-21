const functions = require('firebase-functions');
const axios = require('axios').default;
const Firestore = require ('@google-cloud/firestore');

// No idea if any of this is right.
const PROJECTID = 'potluck-d1796';

const firestore = new Firestore({
    projectID: PROJECTID,
    timestampsInSnapshots: true,
});

// Fetch api key from environment variable
const apiKey = functions.config().spoonacular.key;

// Define custom request config for api calls to Spoonacular
const axiosSpoonacular = axios.create({
    baseURL: 'https://api.spoonacular.com'
});

// Automatically add API key to all Spoonacular requests
axiosSpoonacular.interceptors.request.use((config) => {
    if (config.params === undefined || config.params === null) {
        config.params = {}
    }
    config.params['apiKey'] = apiKey;
    return config;
});

exports.recipesByIngredients = functions.https.onCall(async (data, context) => {

    // Deny unauthenticated requests
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Caller is not authenticated');
    }

    // TODO: Validate/format ingredients list from data
    var ingredients = data.ingredients;
        
    try {
        // Call Spoonacular API findByIngredients endpoint
        var res = await axiosSpoonacular.get('recipes/findByIngredients',{
            params: {
                // Comma-separated list of ingredients that the recipes should contain
                ingredients: ingredients,

                // Recipes should have an open license that allows display with proper attribution
                limitLicense: true,

                // Maximize used ingredients (1) or minimize missing ingredients (2)
                ranking: 1,

                // Ignore typical pantry items, such as water, salt, flour, etc.
                ignorePantry: true
            }
        });
        // If call was successful, return results directly
        return res.data;
    }
    catch (error) {
        // Return error-specific message if one exists
        if (error.response) {
            // Spoonacular responded with error; return it
            // Obviously in production, this could be insecure (exposes backend info)
            throw new functions.https.HttpsError('aborted', 'Error fetching recipes', error.response);
        }
        // Some kind of network/request error; return error message
        throw new functions.https.HttpsError('unknown', 'Server error', {message: error.message});
    }
});

exports.recipeInfo = functions.https.onCall(async (data, context) => {

    // Deny unauthenticated requests
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Caller is not authenticated');
    }

    // TODO: Validate/format id from data
    var id = data.id;
        
    try {
        // Call Spoonacular API findByIngredients endpoint
        var res = await axiosSpoonacular.get('recipes/' + id + '/information');

        // If call was successful, return results directly
        return res.data;
    }
    catch (error) {
        // Return error-specific message if one exists
        if (error.response) {
            // Spoonacular responded with error; return it
            // Obviously in production, this could be insecure (exposes backend info)
            console.error(error.response);
            throw new functions.https.HttpsError('aborted', 'Error fetching recipe info', error.response);
        }
        // Some kind of network/request error; return error message
        console.error(error.message);
        throw new functions.https.HttpsError('unknown', 'Server error', {message: error.message});
    }
});

exports.newAccount = functions.auth.user().onCreate((user) => {
    const email = user.email;
    const id = user.uid;

    // Check that session is not anonymous
    if (user.providerData.length === 0){
        return null;
    } else {
        // Create new doc within users collection and add user email and id
        return firestore.collection('users')
        .add({email, id})
        .then(doc => {
            return res.status(200).send(doc);
        }).catch(err => {
            // Some kind of error, I got this code from a Firestore/Functions tutorial
            console.error(err);
            return res.status(404).send({ error: 'unable to store', err});
        });
    }
    // TODO: create new friends doc 
});

/*
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
*/
