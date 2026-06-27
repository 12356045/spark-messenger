import { collection, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, query, where, getDoc } from "./vendor/firebase/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { renderAvatar, t } from "./ui.js";
import { playNotificationSound } from "./helpers.js";

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
let screenShareStream = null;
let screenShareActive = false;
let currentUserObjRef = null;
let speakingAnalyser = null;
let speakingAnimFrame = null;
let localSpeakingAnimFrame = null;
let currentRemoteParticipant = null;
let currentLocalParticipant = null;
let incomingCallListenerUnsub = null;

function setRemoteJoined(joined) {
    const avatarContainer = document.getElementById('callAvatarContainer');
    if (!avatarContainer) return;
    if (joined) {
        avatarContainer.classList.remove('not-joined');
        avatarContainer.classList.add('joined');
    } else {
        avatarContainer.classList.remove('joined');
        avatarContainer.classList.add('not-joined');
    }
}

function cleanupCallState() {
    if (callStateUnsub) { try { callStateUnsub(); } catch(e) {} callStateUnsub = null; }
    if (candidateUnsub) { try { candidateUnsub(); } catch(e) {} candidateUnsub = null; }
    if (screenShareStream) { screenShareStream.getTracks().forEach(t => t.stop()); screenShareStream = null; }
    screenShareActive = false;
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (remoteAudioEl) { remoteAudioEl.srcObject = null; remoteAudioEl.remove(); remoteAudioEl = null; }
    if (peerConnection) { try { peerConnection.close(); } catch(e) {} peerConnection = null; }
    if (speakingAnimFrame) { cancelAnimationFrame(speakingAnimFrame); speakingAnimFrame = null; }
    if (localSpeakingAnimFrame) { cancelAnimationFrame(localSpeakingAnimFrame); localSpeakingAnimFrame = null; }
    speakingAnalyser = null;
    remoteCandidatesQueue = [];
    currentCallId = null;
    onTrackFired = false;
    currentRemoteParticipant = null;
    currentLocalParticipant = null;
    const overlay = document.getElementById('callOverlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.classList.remove('call-active');
    }
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const localPip = document.getElementById('callLocalPip');
    const remoteParticipant = document.getElementById('callRemoteParticipant');
    const localParticipant = document.getElementById('callLocalParticipant');
    if (localVideo) { localVideo.srcObject = null; }
    if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = 'none'; }
    if (localPip) localPip.classList.remove('local-visible');
    if (remoteParticipant) remoteParticipant.classList.remove('speaking');
    if (localParticipant) localParticipant.classList.remove('speaking');
    const avatarContainer = document.getElementById('callAvatarContainer');
    const localAvatar = document.getElementById('callLocalAvatarContainer');
    if (avatarContainer) {
        avatarContainer.style.display = 'flex';
        avatarContainer.classList.remove('joined', 'not-joined');
    }
    if (localAvatar) {
        localAvatar.style.display = 'flex';
        localAvatar.classList.remove('joined', 'not-joined');
    }
}

function setupCallUI(video, targetInfo) {
    const overlay = document.getElementById('callOverlay');
    const avatarContainer = document.getElementById('callAvatarContainer');
    const remoteVideo = document.getElementById('remoteVideo');
    const nameDisplay = document.getElementById('callUserNameDisplay');
    const statusText = document.getElementById('callStatusText');
    const remoteName = document.getElementById('callRemoteName');
    const localName = document.getElementById('callLocalName');
    const localAvatar = document.getElementById('callLocalAvatarContainer');
    const incomingActions = document.getElementById('incomingActions');
    const activeCallActions = document.getElementById('activeCallActions');
    const localPip = document.getElementById('callLocalPip');

    if (overlay) overlay.style.display = 'flex';
    overlay.classList.add('call-active');
    if (nameDisplay) nameDisplay.textContent = targetInfo?.name || '';
    if (remoteName) remoteName.textContent = targetInfo?.name || '';
    if (statusText) statusText.textContent = t('calling');
    renderAvatar(avatarContainer, { avatarUrl: targetInfo?.avatarUrl, name: targetInfo?.name });

    if (currentUserObjRef) {
        if (localName) localName.textContent = currentUserObjRef.name || '';
        renderAvatar(localAvatar, { avatarUrl: currentUserObjRef.avatarUrl, name: currentUserObjRef.name });
    }

    if (remoteVideo) remoteVideo.style.display = 'none';
    if (avatarContainer) {
        avatarContainer.style.display = 'flex';
        avatarContainer.classList.add('not-joined');
        avatarContainer.classList.remove('joined');
    }
    if (localAvatar) {
        localAvatar.style.display = 'flex';
        localAvatar.classList.add('joined');
        localAvatar.classList.remove('not-joined');
    }
    if (localPip) localPip.classList.remove('local-visible');
    if (incomingActions) incomingActions.style.display = 'none';
    if (activeCallActions) activeCallActions.style.display = 'flex';
}

function startSpeakingDetection(remoteStream) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(remoteStream);
        speakingAnalyser = audioCtx.createAnalyser();
        speakingAnalyser.fftSize = 256;
        source.connect(speakingAnalyser);

        const dataArray = new Uint8Array(speakingAnalyser.frequencyBinCount);
        const remoteParticipant = document.getElementById('callRemoteParticipant');

        function checkLevel() {
            if (!speakingAnalyser || !remoteParticipant) return;
            speakingAnalyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            if (avg > 15) {
                remoteParticipant.classList.add('speaking');
            } else {
                remoteParticipant.classList.remove('speaking');
            }
            speakingAnimFrame = requestAnimationFrame(checkLevel);
        }
        checkLevel();
    } catch(e) {
        console.warn('Speaking detection failed:', e);
    }
}

function startLocalSpeakingDetection(stream) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const localParticipant = document.getElementById('callLocalParticipant');

        function checkLevel() {
            if (!analyser || !localParticipant) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            if (avg > 15) {
                localParticipant.classList.add('speaking');
            } else {
                localParticipant.classList.remove('speaking');
            }
            localSpeakingAnimFrame = requestAnimationFrame(checkLevel);
        }
        checkLevel();
    } catch(e) {
        console.warn('Local speaking detection failed:', e);
    }
}

function hideIncomingBanner() {
    const banner = document.getElementById('incomingCallBanner');
    if (banner) banner.classList.remove('active');
}

function showIncomingBanner(call, callDocId) {
    playNotificationSound();
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
            if (event.track.kind === 'video') {
                const remoteVid = document.getElementById('remoteVideo');
                const avatarContainer = document.getElementById('callAvatarContainer');
                if (remoteVid) {
                    remoteVid.srcObject = remoteStream;
                    remoteVid.style.display = 'block';
                    remoteVid.play().catch(() => {});
                }
                if (avatarContainer) avatarContainer.style.display = 'none';
            }
            if (event.track.kind === 'audio') {
                if (!remoteAudioEl) {
                    remoteAudioEl = document.createElement('audio');
                    remoteAudioEl.autoplay = true;
                    remoteAudioEl.playsInline = true;
                    remoteAudioEl.volume = 1.0;
                    remoteAudioEl.style.display = 'none';
                    document.body.appendChild(remoteAudioEl);
                }
                remoteAudioEl.srcObject = remoteStream;
                remoteAudioEl.play().catch(e => {
                    console.warn('Audio autoplay blocked, retrying:', e);
                    setTimeout(() => { if (remoteAudioEl) remoteAudioEl.play().catch(() => {}); }, 1000);
                });
                startSpeakingDetection(remoteStream);
            }
            onTrackFired = true;
            setRemoteJoined(true);
            const statusText = document.getElementById('callStatusText');
            if (statusText) statusText.textContent = isVideo ? t('videoCall') : t('audioCall');
        }
    };
}

function setupCallerIce(pc, callDocId) {
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
    while (remoteCandidatesQueue.length > 0) {
        const c = remoteCandidatesQueue.shift();
        pc.addIceCandidate(c).catch(() => {});
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
    currentUserObjRef = currentUserObj;

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

    startLocalSpeakingDetection(localStream);

    peerConnection = new RTCPeerConnection(getRTCConfig());
    addTracksToPeerConnection(peerConnection, localStream);
    setupRemoteStream(peerConnection, callIsVideo);

    const os = getOS();
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
        if (d.status === 'active') {
            setRemoteJoined(true);
            const statusText = document.getElementById('callStatusText');
            if (statusText) statusText.textContent = callIsVideo ? t('videoCall') : t('audioCall');
        }
        if (d.status === 'ended') cleanupCallState();
    });

    return true;
}

async function acceptIncomingCall(call, callDocId) {
    cleanupCallState();
    hideIncomingBanner();
    currentCallId = callDocId;
    callIsVideo = call.video;
    currentUserObjRef = currentUserObjRef || {};

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

    startLocalSpeakingDetection(localStream);

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

            if (peerConnection.localDescription) {
                await updateDoc(doc(db, "calls", callDocId), {
                    answer: JSON.stringify({ type: peerConnection.localDescription.type, sdp: peerConnection.localDescription.sdp }),
                    status: "active"
                }).catch(e => console.error('Failed to save answer:', e));
            }
            setRemoteJoined(true);
            const statusText = document.getElementById('callStatusText');
            if (statusText) statusText.textContent = callIsVideo ? t('videoCall') : t('audioCall');
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
    currentUserObjRef = currentUserObj;
    if (incomingCallListenerUnsub) { incomingCallListenerUnsub(); incomingCallListenerUnsub = null; }
    const q = query(collection(db, "calls"), where("targetId", "==", currentUserObj.uid));
    incomingCallListenerUnsub = onSnapshot(q, async (snap) => {
        for (const change of snap.docChanges()) {
            const d = change.doc;
            const call = d.data();
            if (!call) continue;
            if (call.callerId === currentUserObj.uid) continue;

            if (change.type === 'added') {
                if (call.status !== "calling") continue;
                if (activeIncomingCallId === d.id) continue;

                activeIncomingCallId = d.id;

                let callerName = call.callerName || 'Пользователь';
                let callerAvatar = call.callerAvatar || '';
                if (!callerAvatar) {
                    try {
                        const callerDoc = await getDoc(doc(db, "calls", d.id));
                        const callerData = callerDoc.exists() ? callerDoc.data() : null;
                        if (!callerData?.callerAvatar) {
                            const userDoc = await getDoc(doc(db, "users", call.callerId));
                            if (userDoc.exists()) {
                                callerAvatar = userDoc.data().avatarUrl || '';
                                if (!call.callerName) callerName = userDoc.data().name || 'Пользователь';
                            }
                        }
                    } catch(e) {}
                }

                showIncomingBanner({ ...call, callerName, callerAvatar }, d.id);

                const acceptBtn = document.getElementById('incomingAcceptBtn');
                const declineBtn = document.getElementById('incomingDeclineBtn');

                if (acceptBtn) {
                    acceptBtn.onclick = () => {
                        activeIncomingCallId = null;
                        acceptIncomingCall({ ...call, callerName, callerAvatar }, d.id);
                    };
                }
                if (declineBtn) {
                    declineBtn.onclick = async () => {
                        await updateDoc(doc(db, "calls", d.id), { status: "ended" }).catch(() => {});
                        activeIncomingCallId = null;
                        hideIncomingBanner();
                    };
                }
            }

            if (change.type === 'modified') {
                if (d.id === activeIncomingCallId && (call.status === 'ended' || call.status === 'active')) {
                    activeIncomingCallId = null;
                    hideIncomingBanner();
                    if (call.status === 'ended') cleanupCallState();
                }
            }
        }

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
    activeIncomingCallId = null;
}

export function stopCallLocal() {
    cleanupCallState();
    activeIncomingCallId = null;
}

export function toggleLocalVideo() {
    if (!localStream) return null;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return null;
    videoTrack.enabled = !videoTrack.enabled;

    const localPip = document.getElementById('callLocalPip');
    const localVideo = document.getElementById('localVideo');
    if (localPip && localVideo) {
        if (videoTrack.enabled) {
            localVideo.srcObject = localStream;
            localPip.classList.add('local-visible');
        } else {
            localPip.classList.remove('local-visible');
        }
    }

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
            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            }
        }

        const localVid = document.getElementById('localVideo');
        if (localVid) localVid.srcObject = localStream;

        showDynamicIsland('Камера переключена', 'info');
    } catch(err) {
        console.warn('Camera switch error:', err);
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

export async function toggleScreenShare() {
    if (screenShareActive && screenShareStream) {
        stopScreenShare();
        return false;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        if (!window.electronAPI?.isElectron) {
            showDynamicIsland('Демонстрация экрана не поддерживается в этом браузере', 'error');
            return false;
        }
    }

    if (window.electronAPI?.isElectron) {
        startScreenShareElectron();
        return true;
    }

    showScreenSharePicker();
    return true;
}

function showScreenSharePicker() {
    let existing = document.getElementById('screenSharePickerModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'screenSharePickerModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(10px);';
    
    const card = document.createElement('div');
    card.style.cssText = 'background:#1e1f22;border-radius:16px;padding:24px;width:340px;max-width:90vw;border:1px solid rgba(255,255,255,0.1);';
    
    card.innerHTML = `
        <h3 style="color:#fff;font-size:16px;font-weight:700;margin:0 0 6px;">Демонстрация экрана</h3>
        <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 16px;">Выберите, что показать:</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
            <button id="ssPickScreen" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;cursor:pointer;font-size:14px;">
                <i class="fas fa-tv" style="font-size:20px;width:28px;text-align:center;color:rgba(255,255,255,0.7);"></i>
                <div style="text-align:left;"><div style="font-weight:600;">Весь экран</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">Весь рабочий стол</div></div>
            </button>
            <button id="ssPickWindow" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;cursor:pointer;font-size:14px;">
                <i class="fas fa-window-maximize" style="font-size:20px;width:28px;text-align:center;color:rgba(255,255,255,0.7);"></i>
                <div style="text-align:left;"><div style="font-weight:600;">Окно приложения</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">Отдельное окно</div></div>
            </button>
            <button id="ssPickTab" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;cursor:pointer;font-size:14px;">
                <i class="fas fa-globe" style="font-size:20px;width:28px;text-align:center;color:rgba(255,255,255,0.7);"></i>
                <div style="text-align:left;"><div style="font-weight:600;">Вкладка браузера</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">Отдельная вкладка</div></div>
            </button>
        </div>
        <button id="ssPickCancel" style="width:100%;margin-top:12px;padding:10px;background:transparent;border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;">Отмена</button>
    `;

    modal.appendChild(card);
    document.body.appendChild(modal);

    document.getElementById('ssPickCancel').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('ssPickScreen').onclick = () => { modal.remove(); startScreenShareWithSurface('monitor'); };
    document.getElementById('ssPickWindow').onclick = () => { modal.remove(); startScreenShareWithSurface('window'); };
    document.getElementById('ssPickTab').onclick = () => { modal.remove(); startScreenShareWithSurface('browser'); };
}

async function startScreenShareWithSurface(surfaceType) {
    try {
        const constraints = {
            video: { cursor: 'always', width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
            selfBrowserSurface: 'include',
            systemAudio: 'include'
        };

        if (surfaceType === 'monitor') constraints.video.displaySurface = 'monitor';
        else if (surfaceType === 'window') constraints.video.displaySurface = 'window';
        else if (surfaceType === 'browser') constraints.video.displaySurface = 'browser';

        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        attachScreenShare(stream);

    } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
            showDynamicIsland('Демонстрация экрана отменена', 'info');
        } else {
            console.warn('Screen share error:', err);
            showDynamicIsland('Ошибка демонстрации: ' + err.message, 'error');
        }
    }
}

function stopScreenShare() {
    if (screenShareStream) {
        screenShareStream.getTracks().forEach(t => t.stop());
        screenShareStream = null;
    }
    screenShareActive = false;

    const screenBtn = document.getElementById('toggleScreenShareBtn');
    if (screenBtn) {
        screenBtn.classList.remove('active');
        screenBtn.innerHTML = '<i class="fas fa-desktop"></i>';
    }

    if (peerConnection && localStream) {
        const cameraTrack = localStream.getVideoTracks()[0];
        if (cameraTrack) {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(cameraTrack).catch(() => {});
            }
        }
    }

    const localVid = document.getElementById('localVideo');
    if (localVid && localStream) {
        localVid.srcObject = localStream;
    }

    showDynamicIsland('Демонстрация экрана выключена', 'info');
}

async function startScreenShareElectron() {
    try {
        const sources = await window.electronAPI.getScreenSources();
        if (!sources || sources.length === 0) {
            showDynamicIsland('Не удалось получить список экранов', 'error');
            return;
        }

        let existing = document.getElementById('screenSharePickerModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'screenSharePickerModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(10px);';

        const card = document.createElement('div');
        card.style.cssText = 'background:#1e1f22;border-radius:16px;padding:24px;width:340px;max-width:90vw;border:1px solid rgba(255,255,255,0.1);max-height:70vh;overflow-y:auto;';

        let itemsHtml = `<h3 style="color:#fff;font-size:16px;font-weight:700;margin:0 0 6px;">Демонстрация экрана</h3>
            <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 16px;">Выберите, что показать:</p>
            <div style="display:flex;flex-direction:column;gap:8px;">`;

        sources.forEach(src => {
            const icon = src.name.includes('Screen') || src.name.includes('Экран') ? 'fa-tv' : 'fa-window-maximize';
            itemsHtml += `<button data-source-id="${src.id}" class="ss-electron-pick" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;cursor:pointer;font-size:14px;">
                <i class="fas ${icon}" style="font-size:20px;width:28px;text-align:center;color:rgba(255,255,255,0.7);"></i>
                <div style="text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${src.name}</div>
            </button>`;
        });

        itemsHtml += `</div>
            <button id="ssPickCancel" style="width:100%;margin-top:12px;padding:10px;background:transparent;border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;">Отмена</button>`;

        card.innerHTML = itemsHtml;
        modal.appendChild(card);
        document.body.appendChild(modal);

        document.getElementById('ssPickCancel').onclick = () => modal.remove();
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        modal.querySelectorAll('.ss-electron-pick').forEach(btn => {
            btn.onclick = async () => {
                const sourceId = btn.dataset.sourceId;
                modal.remove();
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1920, maxHeight: 1080 } }
                    });
                    attachScreenShare(stream);
                } catch(err) {
                    console.warn('Electron screen share error:', err);
                    showDynamicIsland('Ошибка демонстрации: ' + err.message, 'error');
                }
            };
        });

    } catch(err) {
        console.warn('Electron desktopCapturer error:', err);
        showDynamicIsland('Ошибка демонстрации экрана', 'error');
    }
}

function attachScreenShare(stream) {
    const screenTrack = stream.getVideoTracks()[0];
    screenShareStream = stream;
    screenShareActive = true;

    const screenBtn = document.getElementById('toggleScreenShareBtn');
    if (screenBtn) screenBtn.classList.add('active');

    showDynamicIsland('Демонстрация экрана включена', 'success');

    screenTrack.onended = () => stopScreenShare();

    if (peerConnection) {
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(screenTrack).catch(() => {});
        } else {
            peerConnection.addTrack(screenTrack, screenShareStream);
        }
    }

    const localVid = document.getElementById('localVideo');
    if (localVid) localVid.srcObject = screenShareStream;
}
