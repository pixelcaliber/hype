const API_KEY = TURN_API_KEY;

// Initialize ICE server configuration
const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }, // Default STUN servers
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
    ]
};

let localStream;
let remoteStream;
let peerConnection;


async function getTurnServerCreds() {
    try {
        const response = await fetch(`https://${USERNAME}.metered.live/api/v1/turn/credentials?apiKey=${API_KEY}`);

        if (!response.ok) {
            throw new Error(`Failed to fetch TURN credentials: ${response.statusText}`);
        }

        const iceServers = await response.json(); // API response should be valid JSON
        console.log("Received TURN server credentials:", iceServers);

        // Update global servers.iceServers
        servers.iceServers = [...servers.iceServers, ...iceServers];
        console.log("Updated ICE servers configuration:", servers.iceServers);
    } catch (error) {
        console.error("Error fetching TURN server credentials:", error);
    }
}
const socket = io("https://signal-bs3p.onrender.com");
// const socket = io("http://localhost:3000");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const startCallButton = document.getElementById("startCall");
const hangupCallButton = document.getElementById("hangupCall");

// Start the local video stream
async function startLocalStream() {
    try {
        console.log("Getting local media stream...");
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });
        localVideo.srcObject = localStream;
        console.log("Local stream started.");
    } catch (error) {
        console.error("Error accessing media devices.", error);
        alert("Could not access camera/microphone: " + error.message);
    }
}

(async () => {
    await getTurnServerCreds();
    console.log("TURN servers have been initialized.");
})();

// Updated `createPeerConnection` to use the dynamic ICE servers
function createPeerConnection() {
    console.log("Creating peer connection...");
    peerConnection = new RTCPeerConnection({
        iceServers: servers.iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle'
    });

    // Reset remote stream
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        console.log("Adding local track:", track.kind);
        peerConnection.addTrack(track, localStream);
    });

    // Handle remote tracks
    peerConnection.ontrack = event => {
        console.log("Remote track received:", event.track.kind);
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log("Sending ICE candidate:", event.candidate);
            socket.emit("message", {
                type: "candidate",
                payload: {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex
                }
            });
        }
    };

    console.log("PeerConnection created.");
}

// Handle SDP offer/answer messages
async function handleSDPMessage(type, sdp) {
    try {
        if (type === "offer") {
            console.log("Received SDP offer.");
            if (!peerConnection) createPeerConnection();

            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            socket.emit("message", { type: "answer", payload: peerConnection.localDescription });
            console.log("Sent SDP answer.");
        } else if (type === "answer") {
            console.log("Received SDP answer.");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        }
    } catch (error) {
        console.error("SDP handling error:", error);
    }
}

// Handle ICE candidate messages
async function handleICECandidateMessage(candidateData) {
    try {
        if (!peerConnection) {
            console.warn("Peer connection not established. Skipping ICE candidate.");
            return;
        }

        const candidate = new RTCIceCandidate({
            candidate: candidateData.candidate,
            sdpMid: candidateData.sdpMid,
            sdpMLineIndex: candidateData.sdpMLineIndex
        });

        console.log("Adding received ICE candidate:", candidate);
        await peerConnection.addIceCandidate(candidate);
    } catch (error) {
        console.error("Error adding ICE candidate", error);
    }
}

// Listen for messages from the signaling server
socket.on("message", async message => {
    const { type, payload } = message;
    console.log("Received message:", type, payload);

    if (type === "offer" || type === "answer") {
        await handleSDPMessage(type, payload);
    } else if (type === "candidate") {
        await handleICECandidateMessage(payload);
    }
});

// Start the call
startCallButton.addEventListener("click", async () => {
    console.log("Starting call...");
    createPeerConnection();

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit("message", { type: "offer", payload: peerConnection.localDescription });
        console.log("Sent SDP offer.");
    } catch (error) {
        console.error("Call start error:", error);
        alert("Failed to start call: " + error.message);
    }
});

// Hang up the call
function hangupCall() {
    console.log("Ending call...");

    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
    }

    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Clear video sources
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    console.log("Call ended.");
}

// Hang up button event listener
hangupCallButton.addEventListener("click", hangupCall);

// Start the local video stream on page load
startLocalStream();
