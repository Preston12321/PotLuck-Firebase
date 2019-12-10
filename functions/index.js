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
                ignorePantry: true,

                // Fetch 30 results
                number: 30

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

exports.updateFriendPantries = functions.firestore.document('/users/{userId}/userData/pantry').onUpdate(async (change, context) => {
    const userId = context.params.userId;
    var pantry = change.after.data().ingredients;

    // get data from friendList collection
    var friendDoc = await firestore.collection('friendLists').doc(userId).get();
    var friendArray = friendDoc.data().friendIds;

    // loop through friend IDs
    var promises = friendArray.forEach(async (friendId) => {
        // get friendpantries, copy the whole array, find map corresponding to ID, update pantry array, and write over old FP array with update
        var fpRef = firestore.collection('users/' + friendId + '/userData').doc('friendPantries');
        return firestore.runTransaction(async (transaction) => {
            var fpDoc = await transaction.get(fpRef);
            var friendPantries = fpDoc.data().friendPantries;
            friendPantries.forEach((map, index) => {
                if (map.id === userId) {
                    map.pantry = pantry;
                    friendPantries[index] = map;
                }
            });
            transaction.update(fpRef, { friendPantries: friendPantries });
        });
    });

    try {
        await Promise.all(promises);
    } catch (error) {
        console.error(error.message);
    }

});

exports.updateFriendInfo = functions.firestore.document('/users/{userID}').onUpdate(async (change, context) => {

    // const userId = context.params.userId; // This isn't working from console but should work from within app
    const userId = change.after.data().userId;
    var email = change.after.data().email;
    var image = change.after.data().imageURI;

    // get data from friendList collection
    var friendDoc = await firestore.collection('friendLists').doc(userId).get();
    var friendArray = friendDoc.data().friendIds;

    // loop through friend IDs
    var promises = friendArray.forEach(async (friendId) => {
        // get friendpantries, copy the whole array, find map corresponding to ID, update email and image, and write over old FP array with update
        var fpRef = firestore.collection('users/' + friendId + '/userData').doc('friendPantries');
        return firestore.runTransaction(async (transaction) => {
            var fpDoc = await transaction.get(fpRef);
            var friendPantries = fpDoc.data().friendPantries;
            friendPantries.forEach((map, index) => {
                if (map.id === userId) {
                    map.email = email;
                    map.imageURI = image;
                    friendPantries[index] = map;
                }
            });
            transaction.update(fpRef, { friendPantries: friendPantries });
        })
    });

    try {
        await Promise.all(promises);
    } catch (error) {
        console.error(error.message);
    }

});

exports.manageFriendRequests = functions.firestore.document('users/{userId}/userData/friendRequests').onUpdate(async (change, context) => {
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
                var requestFromIds = doc.data().requestFromIds;

                if (requestFromIds.includes(userId)) return;

                requestFromIds.push(userId);
                transaction.update(ref, { 'requestFromIds': requestFromIds });
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

                var requestFromIds1 = docs[0].data().requestFromIds;
                var requestFromIds2 = docs[1].data().requestFromIds;

                var friendIds1 = docs[2].data().friendIds;
                var friendIds2 = docs[3].data().friendIds;

                var clearRequests = false;

                // Already friends. Remove requests from both friendRequests docs
                if (friendIds1.includes(userId) && friendIds2.includes(id)) {
                    clearRequests = true;
                }

                // Both users have requested friendship. Make them friends
                if (requestFromIds1.includes(userId) && clearRequests === false) {
                    friendIds1.push(userId);
                    friendIds2.push(id);

                    transaction.update(ref3, { 'friendIds': friendIds1 });
                    transaction.update(ref4, { 'friendIds': friendIds2 });

                    clearRequests = true;
                }

                // Clear ids from both users' friendRequest docs
                if (clearRequests) {
                    var requestToIds1 = docs[0].data().requestFromIds;
                    var requestToIds2 = docs[1].data().requestFromIds;

                    // Remove each respective user's id from other user's doc wherever present
                    requestFromIds1.splice(requestFromIds1.indexOf(userId), requestFromIds1.includes(userId) ? 1 : 0);
                    requestFromIds2.splice(requestFromIds2.indexOf(id), requestFromIds2.includes(id) ? 1 : 0);
                    requestToIds1.splice(requestToIds1.indexOf(userId), requestToIds1.includes(userId) ? 1 : 0);
                    requestToIds2.splice(requestToIds2.indexOf(id), requestToIds2.includes(id) ? 1 : 0);

                    transaction.update(ref1, { 'requestFromIds': requestFromIds1, 'requestToIds': requestToIds1 });
                    transaction.update(ref2, { 'requestFromIds': requestFromIds2, 'requestToIds': requestToIds2 });
                }
            });
        }));
    }

    if (removalsChanged) {
        promises = promises.concat(removalsAfter.map((id) => {
            var ref1 = firestore.collection('friendLists').doc(id);
            var ref2 = firestore.collection('friendLists').doc(userId);
            var ref3 = firestore.collection('users').doc(userId).collection('userData').doc('friendRequests');
            return firestore.runTransaction(async (transaction) => {
                var docs = await transaction.getAll(ref1, ref2, ref3);
                var friendIds1 = docs[0].data().friendIds;
                var friendIds2 = docs[1].data().friendIds;
                var removeIdsOld = docs[2].data().removeIds;

                // Remove id from removeIds in friendRequests doc
                var removeIdsNew = [];
                removeIdsOld.forEach((removalId) => {
                    if (removalId === id) return;
                    removeIdsNew.push(removalId);
                });

                // Remove user id from other user's friend list if present
                friendIds1.splice(friendIds1.indexOf(userId), friendIds1.includes(userId) ? 1 : 0);
                friendIds2.splice(friendIds2.indexOf(id), friendIds2.includes(id) ? 1 : 0);

                transaction.update(ref1, { 'friendIds': friendIds1 });
                transaction.update(ref2, { 'friendIds': friendIds2 });
                transaction.update(ref3, { 'removeIds': removeIdsNew });
            });
        }));
    }

    try {
        await Promise.all(promises);
    } catch (error) {
        console.error(error.message);
    }
});

exports.manageFriendList = functions.firestore.document('friendLists/{userId}').onUpdate(async (change, context) => {
    const userId = context.params.userId;

    var userDoc = await firestore.collection('users').doc(userId).get();
    var userEmail = userDoc.data().email;
    var userImage = userDoc.data().imageURI

    var userPantryDoc = await userDoc.ref.collection('userData').doc('pantry').get();
    var userPantry = userPantryDoc.data().ingredients;

    var friends = change.after.data().friendIds;
    var friendsBefore = change.before.data().friendIds;

    var promises = friends.map((id) => {
        if (friendsBefore.includes(id)) return Promise.resolve();

        var ref = firestore.collection('users').doc(id).collection('userData').doc('friendPantries');
        return firestore.runTransaction(async (transaction) => {
            var doc = await transaction.get(ref);
            var pantries = doc.data().friendPantries;

            var friendPantry = {
                id: userId,
                email: userEmail,
                imageURI: userImage,
                pantry: userPantry
            };

            pantries.push(friendPantry);

            transaction.update(ref, {
                friendPantries: pantries
            });
        });
    });

    try {
        await Promise.all(promises);
    } catch (error) {
        console.error(error.message);
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
        userId: id,
        imageURI: "gs://potluck-d1796.appspot.com/users/images/profile.png"
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

    // Create new friendPantries doc within userData subcollection, with an empty list of friendPantries
    var friendPantries = userData.doc('friendPantries');
    batch.create(friendPantries, {
        friendPantries: []
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

exports.updateEmail = functions.https.onCall(async (data, context) => {

    // Deny unauthenticated requests
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Caller is not authenticated');
    }

    var query = data.query;
    const userId = context.auth.uid;

    try {
        // Update email field in user's doc
        firestore.collection('users').doc(userId).update({email: query});
    }
    catch (error) {
        // Some kind of network/request error; return error message
        console.error(error.message);
        throw new functions.https.HttpsError('unknown', 'Server error', { message: error.message });
    }
});


exports.deleteAccount = functions.auth.user().onDelete(async (user) => {
    const userId = user.uid;
    var batch = firestore.batch();

    // Get user's list of friends
    var friendDoc = await firestore.collection('friendLists').doc(userId).get();
    var friendArray = friendDoc.data().friendIds;

    // Loop through each friend
    var promises = friendArray.forEach(async (friendId) => {
        var fpRef = firestore.collection('users/' + friendId + '/userData').doc('friendPantries');
        var flRef = firestore.collection('friendLists').doc(friendId);
        return firestore.runTransaction(async (transaction) => {

            // get docs
            var fpDoc = await transaction.get(fpRef);
            var flDoc = await transaction.get(flRef);

            // remove user from each friend's friendPantries
            var friendPantries = fpDoc.data().friendPantries;
            var pantryIndex;
            friendPantries.forEach((map, index) => {
                if (map.id === userId) {
                    pantryIndex = index;
                }
            });
            friendPantries.splice(pantryIndex, 1);
            transaction.update(fpRef, { friendPantries: friendPantries });

            // remove user from each friend's friendList
            var friendIds = flDoc.data().friendIds;
            var flIndex = friendIds.indexOf(userId);
            friendIds.splice(flIndex, 1);
            transaction.update(flRef, { friendIds: friendIds });
        });
    });

    // Delete user's doc within users collection
    var userDoc = firestore.collection('users').doc(userId);
    await recursiveDelete(batch, userDoc);

    // Delete user's doc within friendLists collection
    var friendList = firestore.collection('friendLists').doc(userId);
    batch.delete(friendList);

    try {
        await batch.commit();
        await Promise.all(promises);
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
