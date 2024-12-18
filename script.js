let localStream;
let remoteStream;
let peerConnection;

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" } // Free STUN server
    ]
};

const socket = io("https://signal-bs3p.onrender.com"); // Connect to the signaling server

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const startCallButton = document.getElementById("startCall");
const hangupCallButton = document.getElementById("hangupCall");

// Start the local video stream
async function startLocalStream() {
    try {
        console.log("Getting local media stream...");
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        console.log("Local stream started.");
    } catch (error) {
        console.error("Error accessing media devices.", error);
    }
}

// Create a new peer connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(servers);

    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle remote tracks
    peerConnection.ontrack = event => {
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log("Sending ICE candidate:", event.candidate);
            sendMessage("candidate", event.candidate);
        }
    };

    console.log("PeerConnection created.");
}

// Handle SDP offer/answer messages
async function handleSDPMessage(type, sdp) {
    if (type === "offer") {
        console.log("Received SDP offer.");
        createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage("answer", peerConnection.localDescription);
        console.log("Sent SDP answer.");
    } else if (type === "answer") {
        console.log("Received SDP answer.");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    }
}

// Handle ICE candidate messages
async function handleICECandidateMessage(candidate) {
    try {
        console.log("Adding received ICE candidate:", candidate);
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error("Error adding received ICE candidate", error);
    }
}

// Send messages to the signaling server
function sendMessage(type, payload) {
    console.log(`Sending message: ${type}`, payload);
    socket.emit("message", { type, payload });
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

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendMessage("offer", peerConnection.localDescription);
    console.log("Sent SDP offer.");
});

// Hang up the call
hangupCallButton.addEventListener("click", () => {
    console.log("Ending call...");
    peerConnection.close();
    peerConnection = null;
    remoteStream = null;
    remoteVideo.srcObject = null;
    console.log("Call ended.");
});

// Start the local video stream on page load
startLocalStream();
