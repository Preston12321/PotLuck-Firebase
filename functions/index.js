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

exports.autocomplete = functions.https.onCall(async (data, context) => {

    // TODO: somehow test this eventually

    // Deny unauthenticated requests
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Caller is not authenticated');
    }

    var query = data.query;

    try {
        // Call Spoonacular API autocomplete ingredient search endpoint
        var res = await axiosSpoonacular.get('food/ingredients/autocomplete', {
            params: {
                query: query
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
            console.error(error.response);
            throw new functions.https.HttpsError('aborted', 'Error fetching ingredient suggestions', error.response);
        }
        // Some kind of network/request error; return error message
        console.error(error.message);
        throw new functions.https.HttpsError('unknown', 'Server error', { message: error.message });
    }
});

exports.addToPantry = functions.https.onCall(async (data, context) => {

    // TODO: somehow test this eventually

    const id = context.auth.uid;

    // Deny unauthenticated requests
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Caller is not authenticated');
    }

    var query = data.query;

    try {
        // Call Spoonacular API autocomplete ingredient search endpoint to check that it is a valud ingredient
        var res = await axiosSpoonacular.get('food/ingredients/autocomplete', {
            params: {
                query: query
            }
        });

        // If result is empty list, ingredient is not valid. Return nothing.
        if (res.data.length === 0) {
            return; // TODO: maybe add some error message? Or will that be handled on the front end?
        } else {
            // If ingredient is valid, add it to ingredients array of user's pantry document
            firestore.collection('users/' + id + '/userData').doc(pantry).update({
                ingredients: firebase.firestore.FieldValue.arrayUnion(query)
            })
            // TODO: eventually, update friends' friendPantries
        }
    } catch (error) {
        console.error(error);
    }
});

exports.manageFriends = functions.firestore.document('users/{userId}/userData/friendRequests').onUpdate(async (change, context) => {
    const userId = context.params.userId;

    var requestToBefore = change.before.data().requestToIds;
    var requestToAfter = change.after.data().requestToIds;
    const requestToChanged = !(JSON.stringify(requestToBefore) === JSON.stringify(requestToAfter));

    var requestFromBefore = change.before.data().requestFromIds;
    var requestFromAfter = change.after.data().requestFromIds;
    const requestFromChanged = !(JSON.stringify(requestFromBefore) === JSON.stringify(requestFromAfter));

    var removalsBefore = change.before.data().removeIds;
    var removalsAfter = change.after.data().removeIds;
    const removalsChanged = !(JSON.stringify(removalsBefore) === JSON.stringify(removalsAfter));

    var promises = [];

    if (requestToChanged) {
        promises = promises.concat(requestToAfter.map((id) => {
            if (requestToBefore.includes(id)) return Promise.resolve();

            var ref = firestore.collection('users').doc(id).collection('userData').doc('friendRequests');
            return firestore.runTransaction(async (transaction) => {
                var doc = await transaction.get(ref);
                var requestsFromIds = doc.data().requestsFromIds;

                if (requestsFromIds.includes(userId)) return;

                requestsFromIds.push(userId);
                await transaction.update(doc, { 'requestFromIds': requestsFromIds });
            });
        }));
    }

    if (requestFromChanged) {
        promises = promises.concat(requestFromAfter.map((id) => {
            if (requestFromBefore.includes(id)) return Promise.resolve();

            var ref1 = firestore.collection('users').doc(id).collection('userData').doc('friendRequests');
            var ref2 = firestore.collection('users').doc(userId).collection('userData').doc('friendRequests');
            var ref3 = firestore.collection('friendLists').doc(id);
            var ref4 = firestore.collection('friendLists').doc(userId);
            return firestore.runTransaction(async (transaction) => {
                var docs = await transaction.getAll(ref1, ref2, ref3, ref4);

                var requestsFromIds1 = docs[0].data().requestsFromIds;
                var requestsFromIds2 = docs[1].data().requestsFromIds;

                var friendIds1 = docs[2].data().friendIds;
                var friendIds2 = docs[3].data().friendIds;

                var clearRequests = false;

                // Already friends. Remove requests from both friendRequests docs
                if (friendIds1.includes(userId) && friendIds2.includes(id)) {
                    clearRequests = true;
                }

                // Both users have requested friendship. Make them friends
                if (requestsFromIds1.includes(userId) && clearRequests == false) {
                    friendIds1.push(userId);
                    friendIds2.push(id);

                    transaction.update(ref3, { 'friendIds': friendIds1 });
                    transaction.update(ref4, { 'friendIds': friendIds2 });

                    clearRequests = true;
                }

                // Clear ids from both users' friendRequest docs
                if (clearRequests) {
                    var requestsToIds1 = docs[0].data().requestsFromIds;
                    var requestsToIds2 = docs[1].data().requestsFromIds;

                    // Remove each respective user's id from other user's doc wherever present
                    requestsFromIds1.splice(requestsFromIds1.indexOf(userId), requestsFromIds1.includes(userId) ? 1 : 0);
                    requestsFromIds2.splice(requestsFromIds2.indexOf(id), requestsFromIds2.includes(id) ? 1 : 0);
                    requestsToIds1.splice(requestsToIds1.indexOf(userId), requestsFromIds1.includes(userId) ? 1 : 0);
                    requestsToIds2.splice(requestsToIds2.indexOf(id), requestsFromIds2.includes(id) ? 1 : 0);

                    transaction.update(ref1, { 'requestsFromIds': requestsFromIds1, 'requestsToIds': requestsToIds1 });
                    transaction.update(ref2, { 'requestsFromIds': requestsFromIds2, 'requestsToIds': requestsToIds2 });
                }
            });
        }));
    }

    if (removalsChanged) {
        promises = promises.concat(removalsAfter.map((id) => {
            var ref1 = firestore.collection('friendLists').doc(id);
            var ref2 = firestore.collection('friendLists').doc(userId);
            return firestore.runTransaction(async (transaction) => {
                var docs = await transaction.getAll(ref1, ref2);
                var friendIds1 = docs[0];
                var friendIds2 = docs[1];

                // Remove user id from other user's friend list if present
                friendIds1.splice(friendIds1.indexOf(userId), friendIds1.includes(userId) ? 1 : 0);
                friendIds2.splice(friendIds2.indexOf(id), friendIds2.includes(id) ? 1 : 0);

                transaction.update(ref1, { 'friendIds': friendIds1 });
                transaction.update(ref2, { 'friendIds': friendIds2 });
            });
        }));
    }

    await Promise.all(promises);
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

    // Create new friendRequests doc within userData subcollection, with requestToIds, requestFromIds, and removeIds arrays
    var friendRequests = userData.doc('friendRequests');
    batch.create(friendRequests, {
        requestToIds: [],
        requestFromIds: [],
        removeIds: []
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
