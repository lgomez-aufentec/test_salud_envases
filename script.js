// Global variables for Firebase instances and app state
let app;
let db;
let auth;
let userId = null;
let userName = '';
let leaderboard = [];
let isAuthReady = false;
let messageTimeoutRef = null;
let selectedActivity = '';
let selectedDuration = 0;
let hasSubmittedToday = false;
let currentUserNameTotalSteps = 0;
let currentUserNameTotalCalories = 0;
let uploadedImageBase64 = null; // To store the screenshot

// Define the Firebase configuration and app ID (provided by the environment)
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Helper to format date as YYYY-MM-DD
const getTodayDateString = () => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD
};

// Function to show a temporary message
const showMessage = (msg) => {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = msg;
    messageBox.classList.remove('hidden');
    messageBox.classList.add('animate-fade-in-down');

    if (messageTimeoutRef) {
        clearTimeout(messageTimeoutRef);
    }
    messageTimeoutRef = setTimeout(() => {
        messageBox.classList.remove('animate-fade-in-down');
        messageBox.classList.add('hidden');
    }, 3000); // Message disappears after 3 seconds
};

// Update UI elements based on current state
const updateUI = () => {
    document.getElementById('current-date').textContent = getTodayDateString();
    document.getElementById('user-greeting').textContent = userName ? `¡Hola, ${userName}!` : '';
    document.getElementById('total-steps').textContent = currentUserNameTotalSteps;
    document.getElementById('total-calories').textContent = currentUserNameTotalCalories;

    // Enable/disable user select dropdown based on auth readiness
    document.getElementById('user-select').disabled = !userId;

    // Update submit button state
    const submitButton = document.getElementById('submit-button');
    const isFormComplete = userName && selectedActivity && selectedDuration !== 0 && document.getElementById('manual-steps').value !== '' && uploadedImageBase64;
    submitButton.disabled = hasSubmittedToday || !isFormComplete;
    submitButton.textContent = hasSubmittedToday ? 'Actividad Registrada Hoy' : 'Registrar Actividad Diaria';

    // Update duration buttons
    document.querySelectorAll('.btn-duration').forEach(btn => {
        const duration = parseInt(btn.dataset.duration);
        if (selectedDuration === duration) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });

    // Update leaderboard
    const leaderboardList = document.getElementById('leaderboard-list');
    leaderboardList.innerHTML = ''; // Clear existing list

    if (leaderboard.length === 0) {
        leaderboardList.innerHTML = '<li class="text-gray-600 text-center">No hay participantes aún. ¡Sé el primero!</li>';
    } else {
        // Display only top 3
        const top3 = leaderboard.slice(0, 3);
        top3.forEach((user, index) => {
            const listItem = document.createElement('li');
            listItem.className = `leaderboard-item ${user.userName === userName ? 'current-user' : ''}`;
            listItem.innerHTML = `
                <div class="flex items-center">
                    <span class="text-xl font-bold text-gray-700 mr-3">${index + 1}.</span>
                    <span class="font-medium text-gray-800 truncate">${user.userName}</span>
                </div>
                <div class="text-right">
                    <p class="text-lg font-semibold text-red-700">${user.totalSteps} pasos</p>
                    <p class="text-sm text-gray-500">${user.totalCalories} calorías</p>
                </div>
            `;
            leaderboardList.appendChild(listItem);
        });
    }

    const currentUserPositionElement = document.getElementById('current-user-position');
    if (userName && currentUserPosition > 0) {
        currentUserPositionElement.textContent = `¡Tu posición actual es: ${currentUserPosition}!`;
    } else {
        currentUserPositionElement.textContent = '';
    }
};

// Calculate current user's position (global scope for updateUI)
let currentUserPosition = 0;

// Firebase Authentication and Firestore setup
const setupFirebase = async () => {
    try {
        // Access Firebase objects via the global 'firebase' namespace
        app = firebase.initializeApp(firebaseConfig); 
        db = firebase.firestore(); // Use firebase.firestore() directly
        auth = firebase.auth(); // Use firebase.auth() directly

        firebase.auth().onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isAuthReady = true;
                console.log("User authenticated:", userId);
            } else {
                userId = null;
                isAuthReady = true;
                console.log("No user authenticated, signing in anonymously.");
                await firebase.auth().signInAnonymously();
            }
            updateUI(); // This should update the disabled state of user-select
        });

        if (initialAuthToken) {
            await firebase.auth().signInWithCustomToken(initialAuthToken);
        } else {
            await firebase.auth().signInAnonymously();
        }

    } catch (error) {
        console.error("Error during Firebase initialization or authentication:", error);
        showMessage("Error al iniciar la aplicación. Inténtalo de nuevo.");
    }
};

// Load data for the selected userName and check daily submission status
const loadUserNameData = async () => {
    if (!isAuthReady || !userName) {
        currentUserNameTotalSteps = 0;
        currentUserNameTotalCalories = 0;
        hasSubmittedToday = false;
        updateUI();
        return;
    }

    try {
        const userLeaderboardDocRef = db.collection(`artifacts/${appId}/public/data/leaderboardUsers`).doc(userName);
        const userLeaderboardSnap = await userLeaderboardDocRef.get();

        if (userLeaderboardSnap.exists) {
            const userData = userLeaderboardSnap.data();
            currentUserNameTotalSteps = userData.totalSteps || 0;
            currentUserNameTotalCalories = userData.totalCalories || 0;

            const lastSubmissionDateForThisUserName = userData.lastSubmissionDate;
            if (lastSubmissionDateForThisUserName && lastSubmissionDateForThisUserName === getTodayDateString()) {
                hasSubmittedToday = true;
            } else {
                hasSubmittedToday = false;
            }
        } else {
            await userLeaderboardDocRef.set({
                userName: userName,
                totalSteps: 0,
                totalCalories: 0,
                lastSubmissionDate: '',
            });
            currentUserNameTotalSteps = 0;
            currentUserNameTotalCalories = 0;
            hasSubmittedToday = false;
        }
    } catch (error) {
        console.error("Error loading user name data:", error);
        showMessage("Error al cargar datos del usuario.");
    } finally {
        updateUI();
    }
};

// Real-time leaderboard updates
const setupLeaderboardListener = () => {
    if (!isAuthReady) return;

    const leaderboardCollectionRef = db.collection(`artifacts/${appId}/public/data/leaderboardUsers`);

    leaderboardCollectionRef.onSnapshot((snapshot) => {
        const usersData = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.userName && data.totalSteps !== undefined && data.totalCalories !== undefined) {
                usersData.push({ id: doc.id, ...data });
            }
        });
        // Sort by totalSteps in descending order
        usersData.sort((a, b) => b.totalSteps - a.totalSteps);
        leaderboard = usersData;
        console.log("Leaderboard updated:", leaderboard);

        // Update current user's displayed steps/calories if their name is selected
        const currentUserEntry = usersData.find(user => user.userName === userName);
        if (currentUserEntry) {
            currentUserNameTotalSteps = currentUserEntry.totalSteps;
            currentUserNameTotalCalories = currentUserEntry.totalCalories;
        }

        currentUserPosition = leaderboard.findIndex(user => user.userName === userName) + 1;
        updateUI();
    }, (error) => {
        console.error("Error fetching leaderboard:", error);
        showMessage("Error al cargar el tablero de clasificación.");
    });
};

// Handle user name selection
const handleUserNameChange = async (event) => {
    const selectedName = event.target.value;
    userName = selectedName;
    await loadUserNameData(); // Load data for the newly selected user
    updateUI();
};

// Handle activity selection
const handleActivityChange = (event) => {
    selectedActivity = event.target.value;
    updateUI();
};

// Handle duration selection
const handleDurationChange = (duration) => {
    selectedDuration = duration;
    updateUI();
};

// Handle manual steps input
const handleManualStepsChange = (event) => {
    // No state needed for this, it's read directly on submission
    updateUI(); // To update button disabled state
};

// Handle image upload
const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
            uploadedImageBase64 = reader.result;
            document.getElementById('screenshot-preview').src = uploadedImageBase64;
            document.getElementById('screenshot-preview').classList.remove('hidden');
            updateUI();
        };
        reader.readAsDataURL(file);
    } else {
        uploadedImageBase64 = null;
        document.getElementById('screenshot-preview').classList.add('hidden');
        document.getElementById('screenshot-preview').src = '';
        updateUI();
    }
};

// Simulate daily activity (steps and calories) based on activity and duration
const calculateActivityData = (manualSteps) => {
    let stepsPerMinute = 70; // Default for walking
    let caloriesPerMinute = 5; // Default for walking

    switch (selectedActivity) {
        case 'Correr': stepsPerMinute = 150; caloriesPerMinute = 10; break;
        case 'Ciclismo': stepsPerMinute = 0; caloriesPerMinute = 8; break;
        case 'Nadar': stepsPerMinute = 0; caloriesPerMinute = 9; break;
        case 'Levantamiento de pesas': stepsPerMinute = 10; caloriesPerMinute = 6; break;
        case 'Fútbol': stepsPerMinute = 120; caloriesPerMinute = 11; break;
        case 'Baloncesto': stepsPerMinute = 110; caloriesPerMinute = 10; break;
        default: stepsPerMinute = 70; caloriesPerMinute = 5; break; // Caminar
    }

    const calculatedStepsFromActivity = stepsPerMinute * selectedDuration;
    const totalCalculatedSteps = calculatedStepsFromActivity + parseInt(manualSteps || 0);
    const totalCalculatedCalories = Math.round(totalCalculatedSteps * 0.04); // Simplified calculation

    return { totalCalculatedSteps, totalCalculatedCalories };
};

// Function to handle daily data submission
const handleDailySubmission = async () => {
    const manualSteps = document.getElementById('manual-steps').value;

    if (!userName || !selectedActivity || selectedDuration === 0 || manualSteps === '' || uploadedImageBase64 === null) {
        showMessage("Por favor, completa toda la información antes de registrar.");
        return;
    }
    if (hasSubmittedToday) {
        showMessage("¡Ya has registrado tu actividad diaria hoy para este usuario!");
        return;
    }

    const todayDate = getTodayDateString();
    const { totalCalculatedSteps, totalCalculatedCalories } = calculateActivityData(manualSteps);

    try {
        // Save daily activity to private subcollection
        const dailySubmissionDocRef = db.collection(`artifacts/${appId}/users/${userId}/dailySubmissions`).doc(todayDate);
        await dailySubmissionDocRef.set({
            steps: totalCalculatedSteps,
            calories: totalCalculatedCalories,
            activity: selectedActivity,
            duration: selectedDuration,
            screenshot: uploadedImageBase64, // Store Base64 image
            timestamp: new Date().toISOString(),
            submittedByUserId: userId,
            submittedByUserName: userName,
        });
        console.log(`Daily submission for ${userName} by Firebase user ${userId} saved.`);

        // Update public leaderboard data (keyed by userName)
        const userLeaderboardDocRef = db.collection(`artifacts/${appId}/public/data/leaderboardUsers`).doc(userName);
        await userLeaderboardDocRef.set({
            userName: userName,
            totalSteps: currentUserNameTotalSteps + totalCalculatedSteps,
            totalCalories: currentUserNameTotalCalories + totalCalculatedCalories,
            lastSubmissionDate: todayDate,
        }, { merge: true });
        console.log(`Leaderboard data for ${userName} updated.`);

        currentUserNameTotalSteps += totalCalculatedSteps;
        currentUserNameTotalCalories += totalCalculatedCalories;
        hasSubmittedToday = true;

        showMessage("¡Actividad diaria registrada exitosamente! ¡Sigue así, campeón!");
        document.getElementById('submit-button').classList.add('pulse-on-submit');
        setTimeout(() => {
            document.getElementById('submit-button').classList.remove('pulse-on-submit');
        }, 500);

        // Reset form fields after successful submission (optional)
        selectedActivity = '';
        selectedDuration = 0;
        document.getElementById('manual-steps').value = '';
        uploadedImageBase64 = null;
        document.getElementById('screenshot-input').value = ''; // Clear file input
        document.getElementById('screenshot-preview').classList.add('hidden');
        document.getElementById('screenshot-preview').src = '';

    } catch (error) {
        console.error("Error saving daily submission:", error);
        showMessage("Error al registrar la actividad diaria.");
    } finally {
        updateUI();
    }
};

// Data for dropdowns (sorted here for convenience)
const simulatedUsers = [
    { id: 'user1', name: 'Ana García' },
    { id: 'user2', name: 'Carlos Ruiz' },
    { id: 'user3', name: 'Diego Sánchez' },
    { id: 'user4', name: 'Elena Ramírez' },
    { id: 'user5', name: 'Javier Fernández' },
    { id: 'user6', name: 'Laura González' },
    { id: 'user7', name: 'Luis Pérez' },
    { id: 'user8', name: 'María López' },
    { id: 'user9', name: 'Pablo Torres' },
    { id: 'user10', name: 'Sofía Martínez' },
].sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically by name

const commonActivities = [
    'Caminar', 'Correr', 'Ciclismo', 'Nadar', 'Levantamiento de pesas', 'Fútbol', 'Baloncesto'
].sort((a, b) => a.localeCompare(b)); // Sort alphabetically

// Initial setup on window load
window.onload = () => {
    // Populate dropdowns initially
    const userSelect = document.getElementById('user-select');
    simulatedUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user.name;
        option.textContent = user.name;
        userSelect.appendChild(option);
    });

    const activitySelect = document.getElementById('activity-select');
    commonActivities.forEach(activity => {
        const option = document.createElement('option');
        option.value = activity;
        option.textContent = activity;
        activitySelect.appendChild(option);
    });

    setupFirebase();
    setupLeaderboardListener(); // Start listening for leaderboard updates
    updateUI(); // Initial UI render

    // Attach event listeners
    document.getElementById('user-select').addEventListener('change', handleUserNameChange);
    document.getElementById('activity-select').addEventListener('change', handleActivityChange);
    document.getElementById('submit-button').addEventListener('click', handleDailySubmission);
    document.getElementById('manual-steps').addEventListener('input', handleManualStepsChange);
    document.getElementById('screenshot-input').addEventListener('change', handleImageUpload);

    document.querySelectorAll('.btn-duration').forEach(btn => {
        btn.addEventListener('click', () => handleDurationChange(parseInt(btn.dataset.duration)));
    });
};
