import { sendLogToServer } from "../js/utils.js";
const socket = io('https://signal-bs3p.onrender.com');



let isVideoEnabled = true;
let isAudioEnabled = true;
let localStream;
let peers = {};
let currentRoomId = null;
let isInitialized = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

const offerOptions = {
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
};

const roomIdInput = document.getElementById('roomId');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomButton = document.getElementById('joinRoomButton');
const callButton = document.getElementById('callButton');
const hangupCall = document.getElementById('hangupCall');
const localVideo = document.getElementById('localVideo');
const audioButton = document.getElementById('toggleAudio');
const videoButton = document.getElementById('toggleVideo');

async function initializeTurnServers() {
    try {
        sendLogToServer('INFO', `Fetching the turn server creds room: ${currentRoomId}`);
        const response = await fetch('https://signal-bs3p.onrender.com/api/turn/credentials');
        if (response.ok) {
            const turnServers = await response.json();
            rtcConfig.iceServers = [...rtcConfig.iceServers, ...turnServers];
        } else {
            sendLogToServer('INFO', `Non 200 response for TURN servers room: ${currentRoomId}. Status: ${response.status}`);
        }
    } catch (error) {
        sendLogToServer('ERROR', `Failed to get TURN servers room: ${currentRoomId}, continuing with STUN only: ${error}`);
    }
}

async function checkMediaTracks(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (!videoTrack?.enabled || !audioTrack?.enabled) {
        console.warn('Media tracks not enabled:', {
            video: videoTrack?.enabled,
            audio: audioTrack?.enabled
        });
    }

    return videoTrack && audioTrack;
}

async function initializeLocalStream() {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            if (!await checkMediaTracks(localStream)) {
                throw new Error('Media tracks unavailable');
            }

            isInitialized = true;
            audioButton.disabled = false;
            videoButton.disabled = false;
        } catch (error) {
            sendLogToServer('ERROR', `Failed to get local media: ${error}`);
            throw error;
        }
    }
    return localStream;
}

async function createPeerConnection(peerId, isInitiator) {
    try {
        await initializeTurnServers();
        const peerConnection = new RTCPeerConnection(rtcConfig);

        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('room_message', {
                    roomId: currentRoomId,
                    receiverId: peerId,
                    type: 'ice-candidate',
                    payload: event.candidate
                });
            }
        };

        peerConnection.onconnectionstatechange = () => {
            sendLogToServer('INFO', `Connection state change: ${peerConnection.connectionState} for peer: ${peerId}`);
        };

        peerConnection.oniceconnectionstatechange = () => {
            sendLogToServer('INFO', `ICE connection state: ${peerConnection.iceConnectionState} for peer: ${peerId}`);
        };

        peerConnection.ontrack = (event) => {
            const videoContainer = document.querySelector('.video-container');
            if (!videoContainer) return;

            let videoElement = document.getElementById(`video-${peerId}`);
            if (!videoElement) {
                videoElement = document.createElement('video');
                videoElement.id = `video-${peerId}`;
                videoElement.autoplay = true;
                videoElement.playsInline = true;
                videoContainer.appendChild(videoElement);
            }
            videoElement.srcObject = event.streams[0];
            hangupCall.disabled = false;
        };

        peers[peerId] = peerConnection;

        if (isInitiator) {
            try {
                const offer = await peerConnection.createOffer(offerOptions)
                    .then(offer => {
                        // Modify SDP to prefer H.264/VP8 for video
                        offer.sdp = offer.sdp.replace(
                            /(m=video.*\r\n)/g,
                            '$1a=fmtp:96 profile-level-id=42e01f;level-asymmetry-allowed=1\r\n'
                        );
                        return pc.setLocalDescription(offer);
                    });;
                await peerConnection.setLocalDescription(offer);
                socket.emit('room_message', {
                    roomId: currentRoomId,
                    receiverId: peerId,
                    type: 'offer',
                    payload: offer
                });
            } catch (error) {
                sendLogToServer('ERROR', `Failed to create/send offer: ${error}`);
                removePeer(peerId);
            }
        }

        return peerConnection;
    } catch (error) {
        sendLogToServer('ERROR', `Failed to create peer connection: ${error}`);
        throw error;
    }
}

function removePeer(peerId) {
    if (peers[peerId]) {
        try {
            peers[peerId].close();
            delete peers[peerId];
            const videoElement = document.getElementById(`video-${peerId}`);
            if (videoElement) videoElement.remove();
        } catch (error) {
            sendLogToServer('ERROR', `Failed to remove peer: ${peerId}. Error: ${error}`);
        }
    }
}

createRoomButton.addEventListener('click', () => {
    try {
        socket.emit('create_room', (roomId) => {
            currentRoomId = roomId;
            roomIdDisplay.textContent = roomId;
            callButton.disabled = false;
        });
    } catch (error) {
        sendLogToServer('ERROR', `Failed to send create room message. Error: ${error}`);
    }
});

joinRoomButton.addEventListener('click', () => {
    try {
        const roomId = roomIdInput.value.trim();
        if (!roomId) return alert('Please enter a room ID');

        socket.emit('join_room', roomId, (success) => {
            if (success) {
                currentRoomId = roomId;
                roomIdDisplay.textContent = roomId;
                callButton.disabled = false;
            } else {
                alert('Failed to join room. Room does not exist.');
            }
        });
    } catch (error) {
        sendLogToServer('ERROR', `Failed to join room: ${roomId} Error: ${error}`);
    }

});

callButton.addEventListener('click', async () => {
    if (!currentRoomId) {
        alert('Join or create a room first')
        return;
    }
    try {
        await initializeLocalStream();
        socket.emit('room_message', {
            roomId: currentRoomId,
            receiverId: 'all',
            type: 'ready',
            payload: null
        });
        callButton.disabled = true;
        hangupCall.disabled = false;
        // hangupCall.classList.remove('hidden');
    } catch (error) {
        alert('Failed to start call: ' + error.message);
        sendLogToServer('ERROR', `Failed to start call: ${error}`);
    }
});

socket.on('room_message', async (data) => {
    const { senderId, type, payload } = data;
    if (senderId === socket.id) return;

    try {
        switch (type) {
            case 'ready':
                if (!isInitialized) {
                    await initializeLocalStream();
                }
                await createPeerConnection(senderId, true);
                break;

            case 'offer':
                if (!isInitialized) {
                    await initializeLocalStream();
                }
                let peerConnection = peers[senderId];
                if (!peerConnection) {
                    peerConnection = await createPeerConnection(senderId, false);
                }
                await peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('room_message', {
                    roomId: currentRoomId,
                    receiverId: senderId,
                    type: 'answer',
                    payload: answer
                });
                break;

            case 'answer':
                if (peers[senderId]) {
                    await peers[senderId].setRemoteDescription(new RTCSessionDescription(payload));
                }
                break;

            case 'ice-candidate':
                if (peers[senderId]) {
                    await peers[senderId].addIceCandidate(new RTCIceCandidate(payload));
                }
                break;
        }
    } catch (error) {
        sendLogToServer('ERROR', `Error handling ${type} message: ${error}`);
    }
});

socket.on('room_users', (data) => {
    const { users } = data;
    const disconnectedPeers = Object.keys(peers).filter(peerId => !users.includes(peerId));
    disconnectedPeers.forEach(removePeer);
});

socket.on('disconnect', () => {
    try {
        Object.keys(peers).forEach(removePeer);
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        localVideo.srcObject = null;
        currentRoomId = null;
        roomIdDisplay.textContent = 'No room joined';
        isInitialized = false;
    } catch (error) {
        sendLogToServer('ERROR', `Failed to disconnect from room. Error: ${error}`);
    }
});

hangupCall.addEventListener('click', () => {
    try {
        socket.emit('leave_room', currentRoomId);
        Object.keys(peers).forEach(removePeer);

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        localVideo.srcObject = null;
        currentRoomId = null;
        roomIdDisplay.textContent = 'No room joined';
        callButton.disabled = true;
        hangupCall.disabled = true;
        audioButton.disabled = true;
        videoButton.disabled = true;
        isInitialized = false;

        const videoContainer = document.querySelector('.video-container');
        videoContainer.querySelectorAll('video').forEach(video => video.remove());
    } catch (error) {
        sendLogToServer('ERROR', `Failed to leave room. Error: ${error}`);
    }
});

videoButton.addEventListener('click', () => {
    if (!localStream) return;
    try {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            isVideoEnabled = !isVideoEnabled;
            videoTrack.enabled = isVideoEnabled;
            document.getElementById('toggleVideo').textContent =
                isVideoEnabled ? 'Turn Video Off' : 'Turn Video On';
        }
    } catch (error) {
        sendLogToServer('ERROR', `Failed to toggle video. Error: ${error}`);
    }
});

audioButton.addEventListener('click', () => {
    if (!localStream) return;
    try {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioEnabled = !isAudioEnabled;
            audioTrack.enabled = isAudioEnabled;
            document.getElementById('toggleAudio').textContent =
                isAudioEnabled ? 'Turn Audio Off' : 'Turn Audio On';
        }
    } catch (error) {
        sendLogToServer('ERROR', `Failed to toggle audio. Error: ${error}`);
    }
});
