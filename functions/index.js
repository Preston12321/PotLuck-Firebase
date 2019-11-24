const functions = require('firebase-functions');
const axios = require('axios').default;
const admin = require('firebase-admin');

admin.initializeApp();

const firestore = admin.firestore();

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
        var res = await axiosSpoonacular.get('recipes/findByIngredients', {
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
        throw new functions.https.HttpsError('unknown', 'Server error', { message: error.message });
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
        throw new functions.https.HttpsError('unknown', 'Server error', { message: error.message });
    }
});

exports.newAccount = functions.auth.user().onCreate(async (user) => {
    const email = user.email;
    const id = user.uid;

    // Check that session is not anonymous
    if (user.providerData.length === 0) return;

    var batch = firestore.batch();

    // Create new doc within users collection and add user email and id
    var userDoc = firestore.collection('users').doc(id);
    batch.create(userDoc, {
        email: email,
        userId: id
    });

    // Create new doc within friendLists collection and add user id and empty array of friend ids
    var friendList = firestore.collection('friendLists').doc(id);
    batch.create(friendList, {
        userId: id,
        friendIds: []
    });

    // Create new userData subcollection of user doc
    var userData = userDoc.collection('userData');
    // batch.create(userData);

    // Create new friendPantries doc within userData subcollection
    var friendPantries = userData.doc('friendPantries');
    batch.create(friendPantries, {
        pantries: []
    });

    // Create new friendRequests doc within userData subcollection
    var friendRequests = userData.doc('friendRequests');
    batch.create(friendRequests, {
        requestIds: []
    });

    // Create new pantry doc within userData subcollection
    var pantry = userData.doc('pantry');
    batch.create(pantry, {
        ingredients: []
    });

    try {
        await batch.commit();
    }
    catch (error) {
        console.error(error);
    }
});

exports.deleteAccount = functions.auth.user().onDelete(async (user) => {
    const id = user.uid;

    var batch = firestore.batch();

    // TODO: Update user's friends' friendPantries, friendRequests, and friendLists docs

    // Delete user's doc within users collection
    var userDoc = firestore.collection('users').doc(id);
    await recursiveDelete(batch, userDoc);

    // Delete user's doc within friendLists collection
    var friendList = firestore.collection('friendLists').doc(id);
    batch.delete(friendList);

    try {
        await batch.commit();
    }
    catch (error) {
        console.error(error);
    }
});

/**
 * Recursively delete a document and the contents of all its subcollections.
 * @param   {FirebaseFirestore.WriteBatch}          batch     The batched write object to which all the delete operations will be registered.
 * @param   {FirebaseFirestore.DocumentReference}   document  The document to recursively delete.
 */
async function recursiveDelete(batch, document) {
    var collections = await document.listCollections();

    var promises = collections.map(async (collection) => {

        var documents = await collection.listDocuments();

        var recursivePromises = documents.map(async (recursiveDocument) => {
            await recursiveDelete(batch, recursiveDocument);
        });

        await Promise.all(recursivePromises);
    });

    await Promise.all(promises);

    batch.delete(document);
}
