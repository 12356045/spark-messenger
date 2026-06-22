import { collection, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, query, where, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { renderAvatar, t } from "./ui.js";

const showDynamicIsland = (...args) => window.showDynamicIsland(...args);

function getOS() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const isChrome = /Chrome/i.test(ua) && !/Edge/i.test(ua);
    const isFirefox = /Firefox/i.test(ua);
    return { isIOS, isAndroid, isSafari, isChrome, isFirefox, ua };
}

function getRTCConfig() {
    return {
        iceServers: [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] },
            { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
        ],
        iceCandidatePoolSize: 0,
        iceTransportPolicy: 'all'
    };
}

let localStream = null;
let remoteAudioEl = null;
let peerConnection = null;
let currentCallId = null;
let callStateUnsub = null;
let candidateUnsub = null;
let remoteCandidatesQueue = [];
let activeIncomingCallId = null;
let callIsVideo = false;
let onTrackFired = false;

function cleanupCallState() {
    if (callStateUnsub) { try { callStateUnsub(); } catch(e) {} callStateUnsub = null; }
    if (candidateUnsub) { try { candidateUnsub(); } catch(e) {} candidateUnsub = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (remoteAudioEl) { remoteAudioEl.srcObject = null; remoteAudioEl.remove(); remoteAudioEl = null; }
    if (peerConnection) { try { peerConnection.close(); } catch(e) {} peerConnection = null; }
    remoteCandidatesQueue = [];
    currentCallId = null;
    activeIncomingCallId = null;
    onTrackFired = false;
    const overlay = document.getElementById('callOverlay');
    if (overlay) overlay.style.display = 'none';
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
}

function setupCallUI(video, targetInfo) {
    const overlay = document.getElementById('callOverlay');
    const videoContainer = document.getElementById('callVideoContainer');
    const avatarContainer = document.getElementById('callAvatarContainer');
    const nameDisplay = document.getElementById('callUserNameDisplay');
    const statusText = document.getElementById('callStatusText');
    const incomingActions = document.getElementById('incomingActions');
    const activeCallActions = document.getElementById('activeCallActions');

    if (overlay) overlay.style.display = 'flex';
    if (nameDisplay) nameDisplay.textContent = targetInfo?.name || '';
    if (statusText) statusText.textContent = t('calling');
    renderAvatar(avatarContainer, { avatarUrl: targetInfo?.avatarUrl, name: targetInfo?.name });

    if (video) {
        if (videoContainer) videoContainer.style.display = 'block';
        if (avatarContainer) avatarContainer.style.display = 'none';
    } else {
        if (videoContainer) videoContainer.style.display = 'none';
        if (avatarContainer) avatarContainer.style.display = 'flex';
    }
    if (incomingActions) incomingActions.style.display = 'none';
    if (activeCallActions) activeCallActions.style.display = 'flex';
}

function hideIncomingBanner() {
    const banner = document.getElementById('incomingCallBanner');
    if (banner) banner.classList.remove('active');
    activeIncomingCallId = null;
}

function showIncomingBanner(call, callDocId) {
    activeIncomingCallId = callDocId;
    const banner = document.getElementById('incomingCallBanner');
    const nameEl = document.getElementById('incomingCallName');
    const typeEl = document.getElementById('incomingCallType');
    const avatarEl = document.getElementById('incomingCallAvatar');

    if (nameEl) nameEl.textContent = call.callerName || 'Пользователь';
    if (typeEl) typeEl.textContent = call.video ? t('incomingVideo') : t('incomingAudio');
    renderAvatar(avatarEl, { avatarUrl: call.callerAvatar, name: call.callerName });
    if (banner) banner.classList.add('active');
}

function addTracksToPeerConnection(pc, stream) {
    stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
    });
}

function setupRemoteStream(pc, isVideo) {
    pc.ontrack = (event) => {
        console.log('ontrack:', event.track.kind, 'streams:', event.streams?.length);
        if (event.streams && event.streams[0]) {
            const remoteStream = event.streams[0];
            if (isVideo) {
                const remoteVid = document.getElementById('remoteVideo');
                if (remoteVid) {
                    remoteVid.srcObject = remoteStream;
                    remoteVid.play().catch(() => {});
                }
            }
            if (!remoteAudioEl) {
                remoteAudioEl = document.createElement('audio');
                remoteAudioEl.autoplay = true;
                remoteAudioEl.playsInline = true;
                document.body.appendChild(remoteAudioEl);
            }
            remoteAudioEl.srcObject = remoteStream;
            onTrackFired = true;
            const statusText = document.getElementById('callStatusText');
            if (statusText) statusText.textContent = isVideo ? t('videoCall') : t('audioCall');
        }
    };
}

function setupCallerIce(pc, callDocId) {
    const sentCandidates = new Set();
    pc.onicecandidate = (event) => {
        if (event.candidate && callDocId) {
            addDoc(collection(db, "calls", callDocId, "candidates"), {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sender: "caller",
                ts: Date.now()
            }).catch(() => {});
        }
    };
    return sentCandidates;
}

function setupCalleeIce(pc, callDocId) {
    pc.onicecandidate = (event) => {
        if (event.candidate && callDocId) {
            addDoc(collection(db, "calls", callDocId, "candidates"), {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sender: "callee",
                ts: Date.now()
            }).catch(() => {});
        }
    };
}

function drainCandidates(pc) {
    if (!pc || !pc.remoteDescription) return;
    let drained = 0;
    while (remoteCandidatesQueue.length > 0) {
        const c = remoteCandidatesQueue.shift();
        pc.addIceCandidate(c).then(() => { drained++; }).catch(() => {});
    }
}

function listenForCandidates(pc, callDocId, role) {
    const processed = new Set();
    const targetRole = role === 'caller' ? 'callee' : 'caller';
    return onSnapshot(collection(db, "calls", callDocId, "candidates"), (snap) => {
        snap.forEach((change) => {
            if (processed.has(change.id)) return;
            processed.add(change.id);
            const data = change.data();
            if (data.sender === targetRole && pc) {
                const c = { candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex };
                if (pc.remoteDescription) {
                    pc.addIceCandidate(c).catch(() => {});
                } else {
                    remoteCandidatesQueue.push(c);
                }
            }
        });
        if (pc && pc.remoteDescription && remoteCandidatesQueue.length > 0) {
            drainCandidates(pc);
        }
    });
}

async function getLocalMedia(video) {
    const os = getOS();
    const videoConstraints = os.isIOS
        ? { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }
        : { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24 } };
    try {
        return await navigator.mediaDevices.getUserMedia({
            video: video ? videoConstraints : false,
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
    } catch(err) {
        console.warn('getUserMedia failed, trying audio-only:', err);
        try {
            return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
        } catch(err2) {
            console.error('No media available:', err2);
            return null;
        }
    }
}

export async function initiateCall(video, targetUserUID, currentUserObj, targetInfo = {}) {
    cleanupCallState();
    callIsVideo = video;

    const stream = await getLocalMedia(video);
    if (!stream) {
        showDynamicIsland('Нет доступа к микрофону/камере', 'error');
        return false;
    }
    localStream = stream;

    const hasVideo = localStream.getVideoTracks().length > 0;
    if (!hasVideo) callIsVideo = false;

    setupCallUI(callIsVideo, targetInfo);
    const localVideo = document.getElementById('localVideo');
    if (localVideo) { localVideo.srcObject = localStream; localVideo.muted = true; localVideo.play().catch(() => {}); }

    const os = getOS();
    peerConnection = new RTCPeerConnection(getRTCConfig());
    addTracksToPeerConnection(peerConnection, localStream);
    setupRemoteStream(peerConnection, callIsVideo);

    const callRef = await addDoc(collection(db, "calls"), {
        callerId: currentUserObj.uid,
        callerName: currentUserObj.name,
        callerAvatar: currentUserObj.avatarUrl || '',
        targetId: targetUserUID,
        status: "calling",
        video: callIsVideo,
        callerOS: os.isIOS ? 'ios' : os.isAndroid ? 'android' : 'web',
        timestamp: serverTimestamp()
    });
    currentCallId = callRef.id;

    setupCallerIce(peerConnection, currentCallId);
    candidateUnsub = listenForCandidates(peerConnection, currentCallId, 'caller');

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await new Promise((resolve) => {
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        if (peerConnection.iceGatheringState === 'complete') { done(); return; }
        peerConnection.onicegatheringstatechange = () => {
            if (peerConnection.iceGatheringState === 'complete') done();
        };
        setTimeout(done, 3000);
    });

    if (peerConnection.localDescription) {
        await updateDoc(doc(db, "calls", currentCallId), {
            offer: JSON.stringify({ type: peerConnection.localDescription.type, sdp: peerConnection.localDescription.sdp })
        }).catch(e => console.error('Failed to save offer:', e));
    }

    callStateUnsub = onSnapshot(doc(db, "calls", currentCallId), async (snap) => {
        const d = snap.data();
        if (!d) return;
        if (d.answer && peerConnection && peerConnection.signalingState === 'have-local-offer') {
            try {
                await peerConnection.setRemoteDescription(JSON.parse(d.answer));
                drainCandidates(peerConnection);
            } catch(err) {
                console.error('setRemoteDescription answer error:', err);
            }
        }
        if (d.status === 'ended') cleanupCallState();
    });

    return true;
}

async function acceptIncomingCall(call, callDocId) {
    hideIncomingBanner();
    cleanupCallState();
    currentCallId = callDocId;
    callIsVideo = call.video;

    const stream = await getLocalMedia(call.video);
    if (!stream) {
        await updateDoc(doc(db, "calls", callDocId), { status: "ended" }).catch(() => {});
        return;
    }
    localStream = stream;

    const hasVideo = localStream.getVideoTracks().length > 0;
    if (!hasVideo) callIsVideo = false;

    setupCallUI(callIsVideo, { name: call.callerName, avatarUrl: call.callerAvatar });
    const localVideo = document.getElementById('localVideo');
    if (localVideo) { localVideo.srcObject = localStream; localVideo.muted = true; localVideo.play().catch(() => {}); }

    peerConnection = new RTCPeerConnection(getRTCConfig());
    addTracksToPeerConnection(peerConnection, localStream);
    setupRemoteStream(peerConnection, callIsVideo);

    setupCalleeIce(peerConnection, callDocId);
    candidateUnsub = listenForCandidates(peerConnection, callDocId, 'callee');

    if (call.offer && call.offer !== 'undefined') {
        try {
            const offerDesc = JSON.parse(call.offer);
            await peerConnection.setRemoteDescription(offerDesc);
            drainCandidates(peerConnection);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            await new Promise((resolve) => {
                let resolved = false;
                const done = () => { if (!resolved) { resolved = true; resolve(); } };
                if (peerConnection.iceGatheringState === 'complete') { done(); return; }
                peerConnection.onicegatheringstatechange = () => {
                    if (peerConnection.iceGatheringState === 'complete') done();
                };
                setTimeout(done, 3000);
            });

            if (peerConnection.localDescription) {
                await updateDoc(doc(db, "calls", callDocId), {
                    answer: JSON.stringify({ type: peerConnection.localDescription.type, sdp: peerConnection.localDescription.sdp }),
                    status: "active"
                }).catch(e => console.error('Failed to save answer:', e));
            }
        } catch(err) {
            console.error('SDP negotiation error:', err);
        }
    }

    callStateUnsub = onSnapshot(doc(db, "calls", callDocId), (docSnap) => {
        const data = docSnap.data();
        if (data?.status === 'ended') cleanupCallState();
    });
}

export function listenToIncomingCalls(currentUserObj) {
    const q = query(collection(db, "calls"), where("targetId", "==", currentUserObj.uid));
    onSnapshot(q, (snap) => {
        snap.forEach(async (d) => {
            const call = d.data();
            if (call.callerId === currentUserObj.uid) return;
            if (call.status !== "calling") {
                if (activeIncomingCallId === d.id) hideIncomingBanner();
                return;
            }
            if (activeIncomingCallId === d.id) return;

            activeIncomingCallId = d.id;

            let callerName = call.callerName || 'Пользователь';
            let callerAvatar = call.callerAvatar || '';
            if (!callerAvatar) {
                try {
                    const callerDoc = await getDoc(doc(db, "users", call.callerId));
                    if (callerDoc.exists()) {
                        callerAvatar = callerDoc.data().avatarUrl || '';
                        if (!call.callerName) callerName = callerDoc.data().name || 'Пользователь';
                    }
                } catch(e) {}
            }

            showIncomingBanner({ ...call, callerName, callerAvatar }, d.id);

            const acceptBtn = document.getElementById('incomingAcceptBtn');
            const declineBtn = document.getElementById('incomingDeclineBtn');

            if (acceptBtn) {
                acceptBtn.onclick = () => acceptIncomingCall({ ...call, callerName, callerAvatar }, d.id);
            }
            if (declineBtn) {
                declineBtn.onclick = async () => {
                    await updateDoc(doc(db, "calls", d.id), { status: "ended" }).catch(() => {});
                    hideIncomingBanner();
                };
            }
        });

        if (snap.empty) hideIncomingBanner();
    }, (err) => {
        console.error("listenToIncomingCalls error:", err);
    });
}

export async function stopCall() {
    if (currentCallId) {
        await updateDoc(doc(db, "calls", currentCallId), { status: "ended" }).catch(() => {});
    }
    cleanupCallState();
}

export function stopCallLocal() {
    cleanupCallState();
}

export function toggleLocalVideo() {
    if (!localStream) return null;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return null;
    videoTrack.enabled = !videoTrack.enabled;
    return videoTrack.enabled;
}

export function toggleLocalAudio() {
    if (!localStream) return null;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return null;
    audioTrack.enabled = !audioTrack.enabled;
    return audioTrack.enabled;
}

export async function triggerCameraSwitch() {
    if (!localStream) return;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length < 2) return;

        const currentVideoTrack = localStream.getVideoTracks()[0];
        const currentDeviceId = currentVideoTrack ? currentVideoTrack.getSettings().deviceId : null;
        const nextDevice = videoDevices.find(d => d.deviceId !== currentDeviceId) || videoDevices[0];

        if (currentVideoTrack) currentVideoTrack.stop();

        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDevice.deviceId } },
            audio: false
        });
        const newVideoTrack = newStream.getVideoTracks()[0];

        localStream.removeTrack(currentVideoTrack);
        localStream.addTrack(newVideoTrack);

        if (peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(newVideoTrack);
        }
        const localVid = document.getElementById('localVideo');
        if (localVid) localVid.srcObject = localStream;
    } catch(err) {
        console.error("Camera switch error:", err);
    }
}

export function setZoom(zoomLevel) {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : null;
    if (capabilities && capabilities.zoom) {
        const minZoom = capabilities.zoom.min || 1;
        const maxZoom = capabilities.zoom.max || 10;
        const clampedZoom = Math.max(minZoom, Math.min(maxZoom, zoomLevel));
        videoTrack.applyConstraints({ advanced: [{ zoom: clampedZoom }] }).catch(() => {});
    }
}
