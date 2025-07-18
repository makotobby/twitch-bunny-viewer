// Configuration - Initialize with empty values
let config = {
    channelName: '',
    clientId: '',
    accessToken: '',
    maxBunnies: 30,
    moveSpeed: 1.5,
    hopProbability: 0.01,
    refreshInterval: 15000,
    followersOnly: false,
    bunnyScale: {
        viewer: { width: 60, height: 60 },
        streamer: { width: 60, height: 60 },
        mod: { width: 60, height: 60 },
        vip: { width: 60, height: 60 }
    }
};

// Bunny sprites - Using paths that will be uploaded to StreamElements
const bunnyTypes = [
    'BlackWhite', 'Brown2Color', 'BrownWhite', 'BunnyBlack', 
    'BunnyBrown', 'DemonicBunny', 'FantasyBunny', 'GreyBunny', 
    'LightBrown', 'WhiteBunny', 'BlueBunny'
];

// Store sprite URLs - update paths to match your StreamElements uploads
const bunnySprites = {
    viewer: {
        idle: bunnyTypes.map(type => `https://makotobby.github.io/twitch-bunny-viewer/Sprites/${type}/Idle.gif`),
        running: bunnyTypes.map(type => `https://makotobby.github.io/twitch-bunny-viewer/Sprites/${type}/Running.gif`)
    },
    streamer: {
        idle: 'https://makotobby.github.io/twitch-bunny-viewer/Sprites/LightBrown/Idle.gif',
        running: 'https://makotobby.github.io/twitch-bunny-viewer/Sprites/LightBrown/Running.gif'
    },
    mod: {
        idle: 'https://makotobby.github.io/twitch-bunny-viewer/Sprites/BunnyBrown/Idle.gif',
        running: 'https://makotobby.github.io/twitch-bunny-viewer/Sprites/BunnyBrown/Running.gif'
    },
    vip: {
        idle: 'https://makotobby.github.io/twitch-bunny-viewer/Sprites/WhiteBunny/Idle.gif',
        running: 'https://makotobby.github.io/twitch-bunny-viewer/Sprites/WhiteBunny/Running.gif'
    }
};

// Store active bunnies and data
const bunnies = {};
const userPreferences = {};
let activeViewers = new Set();
let broadcasterId = null;
let isConnected = false;
let refreshInterval = null;
let movementInterval = null;

// Get DOM References
const gameContainer = document.getElementById('game-container');

// Handle StreamElements widget load
window.addEventListener('onWidgetLoad', function (obj) {
    const fieldData = obj.detail.fieldData;
    
    // Get configuration from StreamElements fields
    config.channelName = fieldData.channelName;
    config.clientId = fieldData.clientId;
    config.accessToken = fieldData.accessToken;
    config.maxBunnies = fieldData.maxBunnies || 30;
    config.moveSpeed = fieldData.moveSpeed || 1.5;
    config.hopProbability = fieldData.hopProbability || 0.01;
    config.followersOnly = fieldData.followersOnly || false;
    
    // Initialize if we have the required credentials
    if (config.channelName && config.clientId && config.accessToken) {
        initializeApp();
    } else {
        showError("Please configure your Twitch credentials in the widget settings");
    }
});

// Show error messages
function showError(message) {
    const errorElement = document.createElement('div');
    errorElement.style.position = 'absolute';
    errorElement.style.top = '10px';
    errorElement.style.left = '10px';
    errorElement.style.padding = '10px';
    errorElement.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
    errorElement.style.color = 'white';
    errorElement.style.borderRadius = '5px';
    errorElement.style.zIndex = '1000';
    errorElement.textContent = message;
    document.body.appendChild(errorElement);
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        document.body.removeChild(errorElement);
    }, 10000);
}

// Initialize the application
function initializeApp() {
    if (!config.channelName || !config.clientId || !config.accessToken) {
        return; // Wait for configuration
    }
    
    // Clean up any existing intervals
    if (refreshInterval) clearInterval(refreshInterval);
    if (movementInterval) clearInterval(movementInterval);
    
    // Get broadcaster ID first
    getBroadcasterId()
        .then(() => {
            // Start fetching viewers
            fetchViewers();
            
            // Set up intervals for refreshing viewers and updating bunny positions
            refreshInterval = setInterval(fetchViewers, config.refreshInterval);
            movementInterval = setInterval(updateBunnies, 50);
            
            // Connect to chat for real-time interactions
            connectToTwitchChat();
        })
        .catch(error => {
            showError(`Error: ${error.message}`);
            console.error('Initialization error:', error);
        });
}

// Get the broadcaster ID (needed for API calls)
async function getBroadcasterId() {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/users?login=${config.channelName}`, {
            headers: {
                'Client-ID': config.clientId,
                'Authorization': `Bearer ${config.accessToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            broadcasterId = data.data[0].id;
            // Also add the broadcaster as a special bunny
            addBunny(data.data[0].display_name || config.channelName, 'streamer', data.data[0].id);
        } else {
            throw new Error('Could not find channel');
        }
    } catch (error) {
        console.error('Error getting broadcaster ID:', error);
        throw error;
    }
}

// Modify fetchViewers to handle async processing and better role detection
async function fetchViewers() {
    if (!broadcasterId) {
        console.error('No broadcaster ID available');
        return;
    }
    
    try {
        // Get user ID of the authorized user
        if (!config.userId) {
            // First, get the authorized user's ID
            const userResponse = await fetch('https://api.twitch.tv/helix/users', {
                headers: {
                    'Client-ID': config.clientId,
                    'Authorization': `Bearer ${config.accessToken}`
                }
            });
            
            if (!userResponse.ok) {
                throw new Error(`API Error: ${userResponse.status}`);
            }
            
            const userData = await userResponse.json();
            if (userData.data && userData.data.length > 0) {
                config.userId = userData.data[0].id;
                config.userLogin = userData.data[0].login;
                
                // Don't automatically add authenticated user as mod here
                // Let the proper mod check handle this
            } else {
                throw new Error('Could not get user information');
            }
        }
        
        // Use the user's ID as the moderator_id parameter
        const moderatorId = config.userId;
        
        // Fetch the viewers
        const response = await fetch(`https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, {
            headers: {
                'Client-ID': config.clientId,
                'Authorization': `Bearer ${config.accessToken}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('API error details:', errorData);
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        const currentViewers = new Set();
        
        // Process viewers data with async handling - start with no role
        if (data.data) {
            // Create array of promises for processing viewers
            const viewerPromises = data.data.map(async viewer => {
                const username = viewer.user_name;
                const userId = viewer.user_id;
                
                // Initialize everyone as a regular viewer - roles will be assigned later
                let viewerType = 'viewer';
                
                // Only the broadcaster gets immediate role assignment
                if (userId === broadcasterId) {
                    viewerType = 'streamer';
                }
                
                // Add to current viewers
                currentViewers.add(username.toLowerCase());
                
                // Add bunny - other roles will be applied in the role-specific API calls
                await addBunny(username, viewerType, userId);
            });
            
            // Wait for all viewer processing to complete
            await Promise.all(viewerPromises);
            
            isConnected = true;
        }
        
        // Now properly check for roles using specific API endpoints
        try {
            // Check for moderators
            await fetchModerators(currentViewers);
        } catch (e) {
            console.error('Error fetching moderators:', e);
        }
        
        try {
            // Check for VIPs
            await fetchVIPs(currentViewers);
        } catch (e) {
            console.error('Error fetching VIPs:', e);
        }
        
        // Remove bunnies for viewers who left
        removeInactiveViewers(currentViewers);
        
        // Update our active viewers list
        activeViewers = currentViewers;
        
    } catch (error) {
        console.error('Error fetching viewers:', error);
        isConnected = false;
        
        // If it's an authorization error, show error message
        if (error.message.includes('401')) {
            showError('Authentication error. Please update your token in widget settings.');
        }
    }
}

// Helper functions for fetching moderators and VIPs with better error handling
async function fetchModerators(currentViewers) {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${broadcasterId}`, {
            headers: {
                'Client-ID': config.clientId,
                'Authorization': `Bearer ${config.accessToken}`
            }
        });
        
        if (!response.ok) {
            // Don't throw - just log and continue
            console.error('Error fetching moderators:', response.status);
            return;
        }
        
        const data = await response.json();
        
        if (data.data) {
            data.data.forEach(mod => {
                const username = mod.user_name;
                const userId = mod.user_id;
                
                // Skip if this is the broadcaster (who is also a mod)
                if (userId === broadcasterId) return;
                
                // Update the bunny to mod type
                updateBunnyType(username.toLowerCase(), 'mod');
            });
        }
    } catch (error) {
        // Just log the error without stopping the app
        console.error('Error processing moderators:', error);
    }
}

async function fetchVIPs(currentViewers) {
    try {
        const response = await fetch(`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${broadcasterId}`, {
            headers: {
                'Client-ID': config.clientId,
                'Authorization': `Bearer ${config.accessToken}`
            }
        });
        
        if (!response.ok) {
            // Don't throw - just log and continue
            console.error('Error fetching VIPs:', response.status);
            return;
        }
        
        const data = await response.json();
        
        if (data.data) {
            data.data.forEach(vip => {
                const username = vip.user_name;
                const userId = vip.user_id;
                
                // Update the bunny to VIP type
                updateBunnyType(username.toLowerCase(), 'vip');
            });
        }
    } catch (error) {
        // Just log the error without stopping the app
        console.error('Error processing VIPs:', error);
    }
}

// Follower cache to reduce API requests
const followerCache = new Map();
const FOLLOWER_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Check if a user follows the channel
async function checkFollowerStatus(username, userId) {
    // Skip check if followers-only mode is disabled
    if (!config.followersOnly) return true;
    
    // Skip check for special users (streamer, mod, vip)
    if (userId === broadcasterId) return true;
    if (bunnies[username.toLowerCase()]?.type === 'streamer' || 
        bunnies[username.toLowerCase()]?.type === 'mod' || 
        bunnies[username.toLowerCase()]?.type === 'vip') {
        return true;
    }
    
    // Check cache first to avoid API rate limits
    const now = Date.now();
    if (followerCache.has(userId)) {
        const cachedData = followerCache.get(userId);
        if (now - cachedData.timestamp < FOLLOWER_CACHE_DURATION) {
            return cachedData.isFollower;
        }
    }
    
    try {
        const response = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${userId}`, {
            headers: {
                'Client-ID': config.clientId,
                'Authorization': `Bearer ${config.accessToken}`
            }
        });
        
        if (!response.ok) {
            console.error('Error checking follow status:', response.status);
            // If we can't check follow status, default to showing everyone
            return true;
        }
        
        const data = await response.json();
        
        // User is a follower if there's at least one entry in the data array
        const isFollower = data.data && data.data.length > 0;
        
        // Store in cache
        followerCache.set(userId, {
            timestamp: now,
            isFollower: isFollower
        });
        
        return isFollower;
        
    } catch (error) {
        console.error('Error checking follow status:', error);
        // If there's an error checking, default to showing the user
        return true;
    }
}

// Connect to Twitch chat using IRC WebSocket - improved version
function connectToTwitchChat() {
    // Skip TMI.js attempt and go directly to IRC method
    connectWithIRC();
}

// Connect to Twitch chat using IRC WebSocket - improved version
function connectWithIRC() {
    console.log('Connecting to Twitch chat via IRC WebSocket');
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    
    let pingInterval;
    let reconnectTimeout;
    let hasJoinedChannel = false;
    
    ws.onopen = () => {
        console.log('Connected to Twitch chat (IRC)');
        
        // Clear any existing reconnect timeout
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        
        // Set up regular pings to keep connection alive
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('PING :tmi.twitch.tv');
            }
        }, 60000); // Send a ping every minute
        
        // Anonymous connection for just listening
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
        ws.send('PASS SCHMOOPIIE');
        ws.send('NICK justinfan' + Math.floor(Math.random() * 100000));
        ws.send(`JOIN #${config.channelName.toLowerCase()}`);
        
        // Set a timeout to check if we've joined the channel
        setTimeout(() => {
            if (!hasJoinedChannel) {
                console.error('Failed to join channel within timeout, reconnecting...');
                ws.close();
            }
        }, 10000); // 10 second timeout
    };
    
    ws.onmessage = (event) => {
        const message = event.data;
        
        // Handle PING to keep the connection alive
        if (message.startsWith('PING')) {
            ws.send('PONG :tmi.twitch.tv');
            return;
        }
        
        // Check if we actually joined the channel
        if (message.includes(`JOIN #${config.channelName.toLowerCase()}`)) {
            console.log('Successfully joined channel');
            hasJoinedChannel = true;
        }

        console.log(event);
        console.log(message);
        
        // Parse and process chat messages
        if (message.includes('PRIVMSG')) {
            try {
                handleChatMessage(message);
            } catch (error) {
                console.error('Error handling chat message:', error);
            }
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        
        // Clean up
        if (pingInterval) {
            clearInterval(pingInterval);
        }
    };
    
    ws.onclose = () => {
        console.log('Disconnected from Twitch chat');
        
        // Clean up
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        
        // Try to reconnect after a delay
        reconnectTimeout = setTimeout(() => {
            console.log('Attempting to reconnect...');
            connectWithIRC();
        }, 5000);
    };
}

// Handle chat messages to make bunnies interact
function handleChatMessage(message) {
    try {
        console.log("Processing message:", message);
        
        // Extract username from IRC message - try display-name first, then username
        let username;
        const displayNameMatch = message.match(/display-name=([^;]+)/);
        if (displayNameMatch && displayNameMatch[1]) {
            username = displayNameMatch[1];
        } else {
            const userMatch = message.match(/:([^!]+)!/);
            if (!userMatch || !userMatch[1]) return;
            username = userMatch[1];
        }
        
        const normalizedUsername = username.toLowerCase();
        console.log("Username extracted:", username);
        
        // Extract the actual message content - updated to handle \r\n
        const msgContentMatch = message.match(/ PRIVMSG #[^ ]+ :(.+?)(?:\r\n|\r|\n|$)/);
        if (!msgContentMatch || !msgContentMatch[1]) {
            console.log("Failed to extract message content");
            return;
        }
        
        const messageContent = msgContentMatch[1].trim();
        console.log("Message extracted:", messageContent);
        
        // Handle color selection commands
        if (messageContent.startsWith('!bunny ')) {
            console.log("Detected !bunny command");
            const colorChoice = messageContent.substring(7).trim().toLowerCase();
            console.log("Color choice:", colorChoice);
            handleBunnyColorCommand(normalizedUsername, colorChoice);
        } else if (messageContent.startsWith('!bunnycolor ')) {
            const colorChoice = messageContent.substring(11).trim().toLowerCase();
            handleBunnyColorCommand(normalizedUsername, colorChoice);
        } else if (messageContent.startsWith('!bunnycolour ')) {
            const colorChoice = messageContent.substring(12).trim().toLowerCase();
            handleBunnyColorCommand(normalizedUsername, colorChoice);
        } else if (bunnies[normalizedUsername]) {
            // Regular message, show chat bubble for non-command messages
            // Limit chat bubble text length
            const shortMessage = messageContent.length > 25 ? 
                messageContent.substring(0, 22) + '...' : 
                messageContent;
            showChatBubble(normalizedUsername, shortMessage);
            makeBunnyHop(normalizedUsername);
        }
        
        // Check for badges to update bunny types
        if (message.includes('badges=')) {
            const badgesMatch = message.match(/badges=([^;]*)/);
            if (badgesMatch && badgesMatch[1]) {
                const badges = badgesMatch[1];
                
                if (badges.includes('broadcaster/1')) {
                    updateBunnyType(normalizedUsername, 'streamer');
                } else if (badges.includes('moderator/1')) {
                    updateBunnyType(normalizedUsername, 'mod');
                } else if (badges.includes('vip/1')) {
                    updateBunnyType(normalizedUsername, 'vip');
                }
            }
        }
    } catch (error) {
        console.error('Error processing chat message:', error, message);
    }
}

// Handle bunny color selection commands
function handleBunnyColorCommand(username, colorChoice) {
    console.log(`Handling color command for ${username} with choice: ${colorChoice}`);
    
    // Normalize color choice to match the expected format
    colorChoice = colorChoice.toLowerCase();
    
    // List command - show available bunny types
    if (colorChoice === 'list') {
        console.log(`List command detected for ${username}`);
        if (bunnies[username]) {
            makeBunnyHop(username);
        }
        return;
    }
    
    // Map color names to bunny types with common variations
    const colorMap = {
        // Exact folder names
        'blackwhite': 'BlackWhite',
        'brown2color': 'Brown2Color',
        'brownwhite': 'BrownWhite',
        'bunnyblack': 'BunnyBlack',
        'bunnybrown': 'BunnyBrown',
        'demonicbunny': 'DemonicBunny',
        'fantasybunny': 'FantasyBunny',
        'greybunny': 'GreyBunny',
        'graybunny': 'GreyBunny', // Alternative spelling
        'lightbrown': 'LightBrown',
        'whitebunny': 'WhiteBunny',
        
        // Common/shorthand names
        'black': 'BunnyBlack',
        'brown': 'BunnyBrown',
        'brown2': 'Brown2Color',
        'demonic': 'DemonicBunny',
        'fantasy': 'FantasyBunny',
        'grey': 'GreyBunny',
        'gray': 'GreyBunny',
        'white': 'WhiteBunny',
        
        // Random option
        'random': '' 
    };
    
    console.log(`Color map entry for ${colorChoice}: ${colorMap[colorChoice]}`);
    
    // Check if valid color choice - try exact match first, then try direct folder name match
    let bunnyType = colorMap[colorChoice];
    
    if (!bunnyType && bunnyTypes.some(type => type.toLowerCase() === colorChoice)) {
        // If not in our map but matches a folder name directly, use the folder name
        const exactTypeMatch = bunnyTypes.find(type => type.toLowerCase() === colorChoice);
        bunnyType = exactTypeMatch;
        console.log(`Found matching folder name: ${exactTypeMatch}`);
    }
    
    // Invalid color - ignore the command
    if (!bunnyType && colorChoice !== 'list') {
        console.log(`Invalid color choice: ${colorChoice}`);
        return;
    }
    
    // Save user's color preference
    if (!userPreferences[username]) {
        userPreferences[username] = {};
    }
    
    if (colorChoice === 'random') {
        delete userPreferences[username].bunnyType;
        console.log(`Setting random color for ${username}`);
    } else {
        userPreferences[username].bunnyType = bunnyType;
        console.log(`Setting color preference for ${username} to ${bunnyType}`);
    }
    
    // If user has an active bunny, update it immediately
    if (bunnies[username]) {
        console.log(`Updating sprite for ${username}'s bunny`);
        updateBunnySprite(username);
        // Make bunny hop to acknowledge the change
        makeBunnyHop(username);
    } else {
        console.log(`No active bunny found for ${username}`);
    }
}

// Update a bunny's sprite based on user color preference
function updateBunnySprite(username) {
    const normalizedUsername = username.toLowerCase();
    console.log(`Updating sprite for ${normalizedUsername}`);
    
    
    if (!bunnies[normalizedUsername]) {
        console.log(`No bunny found for ${normalizedUsername}`);
        return;
    }
    
    const bunny = bunnies[normalizedUsername];
    console.log(`Found bunny with type: ${bunny.type}`);
    
    // For all users, check if they have a color preference
    if (userPreferences[normalizedUsername]?.bunnyType) {
        const preferredType = userPreferences[normalizedUsername].bunnyType;
        console.log(`User has preference: ${preferredType}`);
        
        // Find the sprite variant for this preference
        const spriteVariant = bunnyTypes.indexOf(preferredType);
        console.log(`Sprite variant index: ${spriteVariant}`);
        
        if (spriteVariant !== -1) {
            // Set the sprite variant
            bunny.spriteVariant = spriteVariant;
            
            // All users use the same sprite array
            bunny.sprites = {
                idle: bunnySprites.viewer.idle[spriteVariant],
                running: bunnySprites.viewer.running[spriteVariant]
            };
            
            console.log(`New idle sprite: ${bunny.sprites.idle}`);
            console.log(`New running sprite: ${bunny.sprites.running}`);
        } else {
            console.log(`Invalid preference, keeping current variant: ${bunny.spriteVariant}`);
        }
    } else {
        // No color preference set - use default for user type
        console.log(`No preference found for ${normalizedUsername}`);
    }
    
    // Update current animation
    updateBunnyAnimation(normalizedUsername, bunny.animationState);
}

// Update bunny type (for moderators, VIPs, etc.)
function updateBunnyType(username, newType) {
    if (bunnies[username]) {
        // Only upgrade types, never downgrade
        if ((newType === 'streamer' && bunnies[username].type !== 'streamer') ||
            (newType === 'mod' && bunnies[username].type !== 'streamer' && bunnies[username].type !== 'mod') ||
            (newType === 'vip' && bunnies[username].type === 'viewer')) {
            
            bunnies[username].type = newType;
            updateBunnyAppearance(username);
        }
    }
}

// Update bunny appearance based on type
function updateBunnyAppearance(username) {
    const normalizedUsername = username.toLowerCase();
    if (!bunnies[normalizedUsername]) return;
    
    const bunny = bunnies[normalizedUsername];
    const type = bunny.type;
    
    // Update CSS classes
    bunny.element.classList.remove('streamer-bunny', 'mod-bunny', 'vip-bunny');
    if (type === 'streamer') bunny.element.classList.add('streamer-bunny');
    if (type === 'mod') bunny.element.classList.add('mod-bunny');
    if (type === 'vip') bunny.element.classList.add('vip-bunny');
    
    // Check if user has a color preference first
    if (userPreferences[normalizedUsername]?.bunnyType) {
        // If user has color preference, don't override it
        console.log(`User ${normalizedUsername} has a color preference, preserving it`);
        updateBunnySprite(normalizedUsername);
    }
    // Only update sprites if no user preference is set
    else if (type === 'streamer') {
        bunny.sprites = {
            idle: bunnySprites.streamer.idle,
            running: bunnySprites.streamer.running
        };
    } else if (type === 'mod') {
        bunny.sprites = {
            idle: bunnySprites.mod.idle,
            running: bunnySprites.mod.running
        };
    } else if (type === 'vip') {
        bunny.sprites = {
            idle: bunnySprites.vip.idle,
            running: bunnySprites.vip.running
        };
    }
    
    // Update dimensions based on type
    bunny.width = config.bunnyScale[type].width;
    bunny.height = config.bunnyScale[type].height;
    bunny.element.style.width = `${bunny.width}px`;
    bunny.element.style.height = `${bunny.height}px`;
    
    // Update animation
    updateBunnyAnimation(normalizedUsername, bunny.animationState);
}

// Remove inactive viewers
function removeInactiveViewers(currentViewers) {
    Object.keys(bunnies).forEach(username => {
        // Don't remove the streamer
        if (bunnies[username].type === 'streamer') return;
        
        // If viewer is no longer in the list, remove their bunny
        if (!currentViewers.has(username.toLowerCase())) {
            removeBunny(username);
        }
    });
}

// Add a bunny for a viewer - modify to make it async
async function addBunny(username, type = 'viewer', userId = null) {
    // Normalize username for comparison
    const normalizedUsername = username.toLowerCase();

    // Special case: assign BlueBunny to BlueLightning714
    if (normalizedUsername === 'bluelightning714') {
        if (!userPreferences[normalizedUsername]) {
            userPreferences[normalizedUsername] = {};
        }
        userPreferences[normalizedUsername].bunnyType = 'BlueBunny';
    }

    // If the bunny already exists, just update its type if needed
    if (bunnies[normalizedUsername]) {
        // Only upgrade viewer types, never downgrade
        if ((type === 'streamer' && bunnies[normalizedUsername].type !== 'streamer') ||
            (type === 'mod' && bunnies[normalizedUsername].type !== 'streamer' && bunnies[normalizedUsername].type !== 'mod') ||
            (type === 'vip' && bunnies[normalizedUsername].type === 'viewer')) {
            
            bunnies[normalizedUsername].type = type;
            updateBunnyAppearance(normalizedUsername);
        }
        return;
    }
    
    // Followers-only check for regular viewers
    if (type === 'viewer' && config.followersOnly && userId) {
        const isFollower = await checkFollowerStatus(username, userId);
        if (!isFollower) {
            // Skip non-followers in followers-only mode
            return;
        }
    }
    
    // Limit the number of bunnies (but always show the streamer)
    if (Object.keys(bunnies).length >= config.maxBunnies && type === 'viewer') return;
    
    // Create the bunny element
    const bunnyElement = document.createElement('div');
    bunnyElement.className = 'bunny';
    
    // Add specific class based on type
    if (type === 'streamer') bunnyElement.classList.add('streamer-bunny');
    if (type === 'mod') bunnyElement.classList.add('mod-bunny');
    if (type === 'vip') bunnyElement.classList.add('vip-bunny');
    
    // Set random position along the floor
    const containerWidth = gameContainer.offsetWidth;
    const x = Math.random() * (containerWidth - 60);
    
    // Determine sprite variant
    let spriteVariant;
    let idleSprite, runningSprite;
    
    // First check if user has a color preference
    if (userPreferences[normalizedUsername]?.bunnyType) {
        // Use user's preferred bunny type
        const preferredType = userPreferences[normalizedUsername].bunnyType;
        spriteVariant = bunnyTypes.indexOf(preferredType);
        
        if (spriteVariant !== -1) {
            // Use the user's preferred color, regardless of user type
            idleSprite = bunnySprites.viewer.idle[spriteVariant];
            runningSprite = bunnySprites.viewer.running[spriteVariant];
            console.log(`Using ${normalizedUsername}'s preferred color: ${preferredType}`);
        } else {
            // Fallback to type-specific default if preference is invalid
            spriteVariant = Math.floor(Math.random() * bunnyTypes.length);
            // Use default sprites for this user type
            if (type === 'streamer') {
                idleSprite = bunnySprites.streamer.idle;
                runningSprite = bunnySprites.streamer.running;
            } else if (type === 'mod') {
                idleSprite = bunnySprites.mod.idle;
                runningSprite = bunnySprites.mod.running;
            } else if (type === 'vip') {
                idleSprite = bunnySprites.vip.idle;
                runningSprite = bunnySprites.vip.running;
            } else {
                idleSprite = bunnySprites.viewer.idle[spriteVariant];
                runningSprite = bunnySprites.viewer.running[spriteVariant];
            }
        }
    } else {
        // No user preference, use defaults by type
        spriteVariant = Math.floor(Math.random() * bunnyTypes.length);
        
        if (type === 'streamer') {
            idleSprite = bunnySprites.streamer.idle;
            runningSprite = bunnySprites.streamer.running;
        } else if (type === 'mod') {
            idleSprite = bunnySprites.mod.idle;
            runningSprite = bunnySprites.mod.running;
        } else if (type === 'vip') {
            idleSprite = bunnySprites.vip.idle;
            runningSprite = bunnySprites.vip.running;
        } else {
            idleSprite = bunnySprites.viewer.idle[spriteVariant];
            runningSprite = bunnySprites.viewer.running[spriteVariant];
        }
    }
    
    // Initially use idle sprite with animation
    bunnyElement.style.backgroundImage = `url('${idleSprite}')`;
    
    // Add name label
    const nameElement = document.createElement('div');
    nameElement.className = 'bunny-name';
    nameElement.textContent = username;
    nameElement.style.bottom = '0px'; // Position closer to bunny
    bunnyElement.appendChild(nameElement);
    
    gameContainer.appendChild(bunnyElement);
    
    // Determine dimensions based on type
    const bunnyWidth = config.bunnyScale[type].width;
    const bunnyHeight = config.bunnyScale[type].height;
    
    // Choose random initial direction
    const initialDirection = Math.random() > 0.5 ? 'right' : 'left';
    
    // Store bunny data
    bunnies[normalizedUsername] = {
        element: bunnyElement,
        x: x,
        targetX: x + (initialDirection === 'right' ? 1 : -1) * (100 + Math.random() * 200),
        type: type,
        direction: initialDirection,
        isHopping: false,
        lastHop: 0,
        userId: userId,
        width: bunnyWidth,
        height: bunnyHeight,
        isMoving: false,
        spriteVariant: spriteVariant,
        sprites: {
            idle: idleSprite,
            running: runningSprite
        },
        animationState: 'idle'
    };
    
    // Apply size
    bunnyElement.style.width = `${bunnyWidth}px`;
    bunnyElement.style.height = `${bunnyHeight}px`;
    
    // Apply initial position
    bunnyElement.style.left = `${x}px`;
    
    // Apply initial direction and transform
    updateBunnyDirection(normalizedUsername);
}

// Remove a bunny
function removeBunny(username) {
    const normalizedUsername = username.toLowerCase();
    if (!bunnies[normalizedUsername]) return;
    
    if (bunnies[normalizedUsername].element) {
        gameContainer.removeChild(bunnies[normalizedUsername].element);
    }
    
    delete bunnies[normalizedUsername];
}

// Make a bunny hop with dynamic height based on speed
function makeBunnyHop(username) {
    const normalizedUsername = username.toLowerCase();
    if (!bunnies[normalizedUsername] || bunnies[normalizedUsername].isHopping) return;
    
    const bunny = bunnies[normalizedUsername];
    const now = Date.now();
    
    // Don't allow hopping too frequently
    if (now - bunny.lastHop < 2000) return;
    
    bunny.isHopping = true;
    bunny.lastHop = now;
    
    // Store previous movement state
    const wasMoving = bunny.isMoving;
    
    // Calculate hop intensity based on movement speed
    const speed = Math.abs(bunny.targetX - bunny.x);
    const hopIntensity = Math.min(1, speed / 100); // Normalize, max 1
    const hopHeight = 20 + (hopIntensity * 30); // Between 20-50px
    const hopDuration = 300 + (200 * (1 - hopIntensity)); // Faster when moving fast
    
    // Apply dynamic hop animation
    bunny.element.style.transition = `transform ${hopDuration}ms cubic-bezier(0.5, 0, 0.5, 1)`;
    bunny.element.style.transform = `${bunny.direction === 'left' ? 'scaleX(-1)' : 'scaleX(1)'} translateY(-${hopHeight}px)`;
    
    // Reset after animation completes
    setTimeout(() => {
        if (bunnies[normalizedUsername]) {
            // Reset transform but keep direction
            bunny.element.style.transition = `transform 200ms cubic-bezier(0.5, 0, 0.5, 1)`;
            bunny.element.style.transform = bunny.direction === 'left' ? 'scaleX(-1)' : 'scaleX(1)';
            
            // After landing animation is complete
            setTimeout(() => {
                if (bunnies[normalizedUsername]) {
                    bunny.element.style.transition = ''; // Remove transition
                    bunnies[normalizedUsername].isHopping = false;
                    
                    // Restore animation state
                    if (wasMoving && !bunnies[normalizedUsername].pauseMovement) {
                        bunnies[normalizedUsername].isMoving = true;
                        updateBunnyAnimation(normalizedUsername, 'running');
                    } else {
                        updateBunnyAnimation(normalizedUsername, 'idle');
                    }
                }
            }, 200);
        }
    }, hopDuration);
}

// Update bunny direction
function updateBunnyDirection(username) {
    const normalizedUsername = username.toLowerCase();
    if (!bunnies[normalizedUsername]) return;
    
    const bunny = bunnies[normalizedUsername];
    const containerWidth = gameContainer.offsetWidth;
    
    // Apply the direction to the bunny element
    if (bunny.direction === 'left') {
        bunny.element.style.transform = 'scaleX(-1)';
        
        // Make sure name doesn't flip
        const nameElement = bunny.element.querySelector('.bunny-name');
        if (nameElement) {
            nameElement.style.transform = 'translateX(-50%) scaleX(-1)';
        }
        
        // Update any existing chat bubble for left-facing bunny
        const bubbleContainer = bunny.element.querySelector('.chat-bubble-container');
        if (bubbleContainer) {
            // Add left-facing class and keep centered
            bubbleContainer.classList.add('left-facing');
            bubbleContainer.style.transform = 'translateX(-50%)';
            
            // Keep the bubble text readable (no transform)
            const chatBubble = bubbleContainer.querySelector('.chat-bubble');
            if (chatBubble) {
                chatBubble.style.transform = 'none';
            }
        }
        
        // Ensure target is to the left of current position
        if (bunny.targetX > bunny.x) {
            bunny.targetX = bunny.x - (100 + Math.random() * 200);
            // Keep within bounds
            if (bunny.targetX < 0) bunny.targetX = 0;
        }
    } else {
        bunny.element.style.transform = 'scaleX(1)';
        
        // Reset name transform
        const nameElement = bunny.element.querySelector('.bunny-name');
        if (nameElement) {
            nameElement.style.transform = 'translateX(-50%)';
        }
        
        // Update any existing chat bubble for right-facing bunny
        const bubbleContainer = bunny.element.querySelector('.chat-bubble-container');
        if (bubbleContainer) {
            // Remove left-facing class and keep centered
            bubbleContainer.style.transform = 'translateX(-50%)';
            
            // Regular transform for right-facing bunny
            const chatBubble = bubbleContainer.querySelector('.chat-bubble');
            if (chatBubble) {
                chatBubble.style.transform = 'none';
            }
        }
        
        // Ensure target is to the right of current position
        if (bunny.targetX < bunny.x) {
            bunny.targetX = bunny.x + (100 + Math.random() * 200);
            // Keep within bounds
            if (bunny.targetX > containerWidth - bunny.width) bunny.targetX = containerWidth - bunny.width;
        }
    }
}

// Update bunny animation state
function updateBunnyAnimation(username, state) {
    const normalizedUsername = username.toLowerCase();
    if (!bunnies[normalizedUsername]) return;
    
    const bunny = bunnies[normalizedUsername];
    
    // Skip if animation state hasn't changed
    if (bunny.animationState === state) return;
    
    // Update animation state
    bunny.animationState = state;
    
    // Set the correct GIF
    bunny.element.style.backgroundImage = `url('${bunny.sprites[state]}')`;
}

// Update all bunny positions
function updateBunnies() {
    const containerWidth = gameContainer.offsetWidth;
    
    Object.keys(bunnies).forEach(username => {
        const bunny = bunnies[username];
        
        // Skip if currently hopping
        if (bunny.isHopping) return;
        
        // Check if bunny needs a new target
        const distanceToTarget = Math.abs(bunny.targetX - bunny.x);
        if (distanceToTarget < 5) {
            // Set new target in the same direction first
            const direction = bunny.direction === 'right' ? 1 : -1;
            let newTargetX = bunny.x + direction * (100 + Math.random() * 200);
            
            // If going off screen, change direction
            if (newTargetX < 0 || newTargetX > containerWidth - bunny.width) {
                bunny.direction = bunny.direction === 'right' ? 'left' : 'right';
                newTargetX = bunny.x + (bunny.direction === 'right' ? 1 : -1) * (100 + Math.random() * 200);
            }
            
            // Randomly change direction sometimes
            if (Math.random() < 0.3) {
                bunny.direction = bunny.direction === 'right' ? 'left' : 'right';
                newTargetX = bunny.x + (bunny.direction === 'right' ? 1 : -1) * (100 + Math.random() * 200);
            }
            
            // Keep within bounds
            newTargetX = Math.max(0, Math.min(containerWidth - bunny.width, newTargetX));
            bunny.targetX = newTargetX;
            
            // Update visuals for direction
            updateBunnyDirection(username);
            
            // Add a pause between movements (looks more natural)
            bunny.pauseMovement = true;
            
            // Switch to idle animation
            bunny.isMoving = false;
            updateBunnyAnimation(username, 'idle');
            
            setTimeout(() => {
                if (bunnies[username]) {
                    bunnies[username].pauseMovement = false;
                }
            }, 500 + Math.random() * 1000);
        }
        
        // Move toward target if not paused
        if (!bunny.pauseMovement) {
            const dx = bunny.targetX - bunny.x;
            const direction = dx > 0 ? 1 : -1;
            bunny.x += direction * config.moveSpeed;
            
            // Check if bunny has reached the edge of the screen
            if (bunny.x <= 0 && bunny.direction === 'left') {
                // Hit left edge, change direction
                bunny.direction = 'right';
                bunny.targetX = bunny.x + (100 + Math.random() * 200);
                updateBunnyDirection(username);
            } else if (bunny.x >= containerWidth - bunny.width && bunny.direction === 'right') {
                // Hit right edge, change direction
                bunny.direction = 'left';
                bunny.targetX = bunny.x - (100 + Math.random() * 200);
                updateBunnyDirection(username);
            }
            
            // Ensure bunny stays within container bounds
            bunny.x = Math.max(0, Math.min(containerWidth - bunny.width, bunny.x));
            
            // Apply position
            bunny.element.style.left = `${bunny.x}px`;
            
            // Set moving state and switch to running animation if not already running
            if (!bunny.isMoving) {
                bunny.isMoving = true;
                updateBunnyAnimation(username, 'running');
            }
            
            // Random hopping
            if (!bunny.isHopping && Math.random() < config.hopProbability) {
                makeBunnyHop(username);
            }
        }
    });
}

// Handle window resize
window.addEventListener('resize', () => {
    const containerWidth = gameContainer.offsetWidth;
    
    // Keep bunnies within bounds
    Object.keys(bunnies).forEach(username => {
        const bunny = bunnies[username];
        if (bunny.x > containerWidth - bunny.width) {
            bunny.x = containerWidth - bunny.width;
            bunny.element.style.left = `${bunny.x}px`;
        }
    });
});

// Show a chat bubble above a bunny
function showChatBubble(username, text) {
    const normalizedUsername = username.toLowerCase();
    if (!bunnies[normalizedUsername]) return;
    
    // Remove any existing chat bubble
    const existingBubble = document.querySelector(`.chat-bubble-for-${normalizedUsername}`);
    if (existingBubble) {
        existingBubble.remove();
    }
    
    const bunny = bunnies[normalizedUsername];
    
    // Create a standalone bubble element positioned absolutely in the game container
    const bubbleElement = document.createElement('div');
    bubbleElement.className = `chat-bubble chat-bubble-for-${normalizedUsername}`;
    bubbleElement.style.position = 'absolute';
    bubbleElement.style.zIndex = '100';
    bubbleElement.style.backgroundColor = 'white';
    bubbleElement.style.border = '2px solid #333';
    bubbleElement.style.borderRadius = '12px';
    bubbleElement.style.padding = '4px 8px';
    bubbleElement.style.fontSize = '14px';
    bubbleElement.style.whiteSpace = 'nowrap';
    bubbleElement.style.pointerEvents = 'none'; // Don't block clicks
    
    // Set text content
    bubbleElement.textContent = text;
    
    // Check if the string length is too long and adjust size or truncate
    const maxLength = 30;
    if (text.length > maxLength) {
        bubbleElement.textContent = text.substring(0, maxLength - 3) + '...';
    }
    
    // If text is very long, allow multiple lines
    if (text.length > 20) {
        bubbleElement.style.maxWidth = '150px';
        bubbleElement.style.whiteSpace = 'normal';
    }
    
    // Add a speech bubble tail/pointer
    const tail = document.createElement('div');
    tail.style.position = 'absolute';
    tail.style.bottom = '-6px';
    tail.style.left = '50%';
    tail.style.transform = 'translateX(-50%) rotate(45deg)';
    tail.style.width = '10px';
    tail.style.height = '10px';
    tail.style.backgroundColor = 'white';
    tail.style.border = 'inherit';
    tail.style.borderTop = 'none';
    tail.style.borderLeft = 'none';
    bubbleElement.appendChild(tail);
    
    // Add the bubble to the game container (not as child of the bunny)
    gameContainer.appendChild(bubbleElement);
    
    // Initial positioning
    updateBubblePosition();
    
    // Function to update the bubble's position based on bunny position and animation
    function updateBubblePosition() {
        if (!bunnies[normalizedUsername]) {
            // Bunny was removed, clean up the bubble
            if (bubbleElement.parentNode) {
                bubbleElement.parentNode.removeChild(bubbleElement);
            }
            return;
        }
        
        // Get current bunny position from DOM to capture ALL transforms including hops
        const bunnyRect = bunny.element.getBoundingClientRect();
        const containerRect = gameContainer.getBoundingClientRect();
        
        // Calculate position that follows the bunny's actual position including hops
        const bubbleX = bunny.x + (bunny.width / 2);
        
        // Get the actual top position of the bunny including any CSS transforms for hopping
        // This makes the bubble follow during jumps
        const actualBunnyTop = bunnyRect.top - containerRect.top;
        
        // Position above the bunny with proper spacing
        const bubbleY = actualBunnyTop - bubbleElement.offsetHeight - 10;
        
        // Apply position
        bubbleElement.style.left = `${bubbleX}px`;
        bubbleElement.style.top = `${Math.max(5, bubbleY)}px`; // Ensure bubble doesn't go off the top
        bubbleElement.style.transform = 'translateX(-50%)';
    }
    
    // Create an interval to update the bubble position with high frequency
    // This is essential to keep the bubble smoothly following the bunny during hops
    const positionInterval = setInterval(updateBubblePosition, 16); // ~60fps update rate
    
    // Remove after a delay
    setTimeout(() => {
        clearInterval(positionInterval);
        if (bubbleElement.parentNode) {
            bubbleElement.parentNode.removeChild(bubbleElement);
        }
    }, 5000);
}