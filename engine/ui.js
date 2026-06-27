/* ============================================================
   SPARK ENGINE — UI Kit
   Reusable UI components: Modal, Toast, Dynamic Island,
   Tabs, Switch, Avatar, Input, Button, Header
   ============================================================ */

import { signal, effect } from './core.js';
import { createElement as h } from './component.js';

// ─── Dynamic Island (toast notifications) ───────────────────

let islandEl = null;
let islandTimer = null;

function getIsland() {
    if (!islandEl) {
        islandEl = document.createElement('div');
        islandEl.id = 'spark-island';
        islandEl.style.cssText = `
            position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);
            z-index:99999;padding:12px 24px;border-radius:20px;font-size:14px;font-weight:600;
            backdrop-filter:blur(20px);transition:transform 0.4s cubic-bezier(0.4,0,0.2,1),opacity 0.3s;
            opacity:0;pointer-events:none;max-width:90vw;text-align:center;
            box-shadow:0 8px 32px rgba(0,0,0,0.4);
        `;
        document.body.appendChild(islandEl);
    }
    return islandEl;
}

export function showToast(message, type = 'info', duration = 3000) {
    const el = getIsland();
    const colors = {
        info: 'background:rgba(60,60,67,0.9);color:#fff;',
        success: 'background:rgba(52,199,89,0.9);color:#fff;',
        error: 'background:rgba(255,59,48,0.9);color:#fff;',
        warning: 'background:rgba(255,149,0,0.9);color:#fff;'
    };
    const icons = {
        info: '💡', success: '✓', error: '✕', warning: '⚠'
    };
    el.style.cssText += colors[type] || colors.info;
    el.innerHTML = `<span style="margin-right:6px;">${icons[type] || ''}</span>${message}`;
    el.style.transform = 'translateX(-50%) translateY(0)';
    el.style.opacity = '1';

    if (islandTimer) clearTimeout(islandTimer);
    islandTimer = setTimeout(() => {
        el.style.transform = 'translateX(-50%) translateY(-100px)';
        el.style.opacity = '0';
    }, duration);
}

// ─── Modal ──────────────────────────────────────────────────

export function createModal(config = {}) {
    const { title = '', content = '', className = '', onClose = null, closeOnOverlay = true } = config;
    const isOpen = signal(false);

    const overlay = h('div', {
        className: `spark-modal-overlay ${className}`,
        style: {
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: '10000', opacity: '0', transition: 'opacity 0.3s',
            backdropFilter: 'blur(4px)'
        }
    });

    const modal = h('div', {
        className: 'spark-modal-card',
        style: {
            background: 'var(--card, #1c1c1e)', borderRadius: '20px',
            padding: '24px', maxWidth: '400px', width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            transform: 'scale(0.9)', transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
            maxHeight: '85vh', overflowY: 'auto', color: 'var(--text, #fff)'
        }
    });

    if (title) {
        const header = h('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }
        }, h('h3', { style: { margin: '0', fontSize: '18px' } }, title),
           h('button', {
               style: { background: 'none', border: 'none', color: 'var(--text-secondary, #8e8e93)', fontSize: '20px', cursor: 'pointer' },
               onclick: () => closeModal()
           }, '✕'));
        modal.appendChild(header);
    }

    if (typeof content === 'string') {
        const body = h('div', { style: { fontSize: '15px', lineHeight: '1.5' } });
        body.innerHTML = content;
        modal.appendChild(body);
    } else if (content instanceof HTMLElement) {
        modal.appendChild(content);
    }

    overlay.appendChild(modal);

    if (closeOnOverlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
    }

    function openModal() {
        document.body.appendChild(overlay);
        isOpen.value = true;
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            modal.style.transform = 'scale(1)';
        });
    }

    function closeModal() {
        overlay.style.opacity = '0';
        modal.style.transform = 'scale(0.9)';
        setTimeout(() => {
            overlay.remove();
            isOpen.value = false;
            onClose?.();
        }, 300);
    }

    return { open: openModal, close: closeModal, isOpen, el: overlay };
}

// ─── Confirm Dialog ─────────────────────────────────────────

export function confirm(title, message, confirmText = 'Да', cancelText = 'Отмена') {
    return new Promise((resolve) => {
        const body = h('div', { style: { textAlign: 'center' } },
            h('p', { style: { marginBottom: '20px', color: 'var(--text-secondary, #8e8e93)' } }, message),
            h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center' } },
                h('button', {
                    style: {
                        padding: '10px 24px', borderRadius: '12px', border: '1px solid var(--border, #38383a)',
                        background: 'transparent', color: 'var(--text, #fff)', fontSize: '14px', fontWeight: '600',
                        cursor: 'pointer', transition: 'all 0.2s'
                    },
                    onclick: () => { modal.close(); resolve(false); }
                }, cancelText),
                h('button', {
                    style: {
                        padding: '10px 24px', borderRadius: '12px', border: 'none',
                        background: 'var(--accent, #ffffff)', color: '#fff', fontSize: '14px', fontWeight: '600',
                        cursor: 'pointer', transition: 'all 0.2s'
                    },
                    onclick: () => { modal.close(); resolve(true); }
                }, confirmText)
            )
        );
        const modal = createModal({ title, content: body, closeOnOverlay: false });
        modal.open();
    });
}

// ─── Tabs ───────────────────────────────────────────────────

export function createTabs(config) {
    const { tabs, container, onSwitch } = config;
    const activeTab = signal(tabs[0]?.id || '');

    function render() {
        if (!container) return;
        const el = typeof container === 'string' ? document.querySelector(container) : container;
        if (!el) return;

        const bar = h('div', {
            className: 'spark-tabs-bar',
            style: {
                display: 'flex', background: 'var(--card, #1c1c1e)', borderRadius: '20px',
                padding: '4px', position: 'relative', overflow: 'hidden'
            }
        });

        tabs.forEach(tab => {
            const btn = h('button', {
                className: 'spark-tab-btn',
                dataset: { tab: tab.id },
                style: {
                    flex: '1', padding: '10px 16px', border: 'none', borderRadius: '18px',
                    background: 'transparent', color: 'var(--text-secondary, #8e8e93)',
                    fontSize: '13px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s',
                    position: 'relative', zIndex: '1'
                },
                onclick: () => switchTab(tab.id)
            }, tab.label);
            bar.appendChild(btn);
        });

        el.innerHTML = '';
        el.appendChild(bar);
        updateStyles();
    }

    function switchTab(id) {
        activeTab.value = id;
        updateStyles();
        onSwitch?.(id);
    }

    function updateStyles() {
        const bar = container?.querySelector?.('.spark-tabs-bar') ||
            (typeof container === 'string' ? document.querySelector(container) : container)?.querySelector?.('.spark-tabs-bar');
        if (!bar) return;
        bar.querySelectorAll('.spark-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === activeTab.value;
            btn.style.color = isActive ? 'var(--accent, #ffffff)' : 'var(--text-secondary, #8e8e93)';
            btn.style.background = isActive ? 'var(--bg, #000)' : 'transparent';
        });
    }

    return { render, switchTab, activeTab };
}

// ─── iOS Switch Toggle ──────────────────────────────────────

export function createSwitch(checked = false, onChange = null) {
    const state = signal(checked);
    const wrapper = h('label', {
        className: 'ios-switch',
        style: { position: 'relative', display: 'inline-block', width: '51px', height: '31px', cursor: 'pointer' }
    });
    const input = h('input', { type: 'checkbox', style: { opacity: '0', width: '0', height: '0' } });
    input.checked = checked;

    const slider = h('span', {
        className: 'switch-slider',
        style: {
            position: 'absolute', inset: '0', background: '#39393d', borderRadius: '31px',
            transition: '0.3s', pointerEvents: 'none'
        }
    }, h('span', {
        style: {
            position: 'absolute', height: '27px', width: '27px', left: '2px', bottom: '2px',
            background: '#fff', borderRadius: '50%', transition: '0.3s',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        }
    }));

    function updateVisual() {
        slider.style.background = state.value ? 'var(--accent, #34c759)' : '#39393d';
        const knob = slider.firstElementChild;
        if (knob) knob.style.transform = state.value ? 'translateX(20px)' : 'translateX(0)';
    }

    input.addEventListener('change', () => {
        state.value = input.checked;
        updateVisual();
        onChange?.(state.value);
    });

    updateVisual();
    wrapper.appendChild(input);
    wrapper.appendChild(slider);

    return { el: wrapper, state, toggle: () => { state.value = !state.value; input.checked = state.value; updateVisual(); onChange?.(state.value); } };
}

// ─── Avatar Renderer ────────────────────────────────────────

export function renderAvatar(avatarUrl, name = '', size = 42) {
    const el = h('div', {
        className: 'spark-avatar',
        style: {
            width: size + 'px', height: size + 'px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent, #ffffff)', color: '#fff',
            fontSize: (size * 0.4) + 'px', fontWeight: '700', overflow: 'hidden',
            flexShrink: '0', userSelect: 'none'
        }
    });

    if (avatarUrl) {
        const img = h('img', {
            src: avatarUrl, alt: name,
            style: { width: '100%', height: '100%', objectFit: 'cover' }
        });
        img.onerror = () => {
            el.innerHTML = '';
            el.appendChild(document.createTextNode(getInitials(name)));
        };
        el.appendChild(img);
    } else {
        el.textContent = getInitials(name);
    }

    return el;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Input Field ────────────────────────────────────────────

export function createInput(config = {}) {
    const { placeholder = '', type = 'text', value = '', label = '', className = '' } = config;
    const state = signal(value);

    const wrapper = h('div', { className: `spark-input-wrapper ${className}`, style: { marginBottom: '12px' } });
    if (label) {
        wrapper.appendChild(h('label', {
            style: { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #8e8e93)' }
        }, label));
    }

    const input = h('input', {
        type, placeholder, value,
        className: 'spark-input',
        style: {
            width: '100%', padding: '12px 16px', borderRadius: '14px',
            border: '1px solid var(--border, #38383a)', background: 'var(--card, #1c1c1e)',
            color: 'var(--text, #fff)', fontSize: '15px', outline: 'none',
            boxSizing: 'border-box', transition: 'border-color 0.2s'
        },
        oninput: () => { state.value = input.value; }
    });

    input.addEventListener('focus', () => { input.style.borderColor = 'var(--accent, #ffffff)'; });
    input.addEventListener('blur', () => { input.style.borderColor = 'var(--border, #38383a)'; });

    wrapper.appendChild(input);
    return { el: wrapper, state, input, focus: () => input.focus() };
}

// ─── Button ─────────────────────────────────────────────────

export function createButton(config = {}) {
    const { text = '', icon = '', onClick, variant = 'primary', className = '' } = config;
    const variants = {
        primary: 'background:var(--accent,#ffffff);color:#fff;',
        secondary: 'background:var(--card,#1c1c1e);color:var(--text,#fff);border:1px solid var(--border,#38383a);',
        danger: 'background:rgba(255,59,48,0.15);color:#ff3b30;',
        ghost: 'background:transparent;color:var(--accent,#ffffff);'
    };

    const btn = h('button', {
        className: `spark-btn spark-btn-${variant} ${className}`,
        style: {
            padding: '12px 24px', borderRadius: '14px', border: 'none',
            fontSize: '15px', fontWeight: '600', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            transition: 'all 0.2s', width: '100%',
            ...parseStyles(variants[variant] || variants.primary)
        },
        onclick: () => onClick?.()
    });
    if (icon) btn.appendChild(h('i', { className: icon }));
    btn.appendChild(document.createTextNode(text));

    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.97)'; });
    btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1)'; });

    return { el: btn };
}

function parseStyles(css) {
    const obj = {};
    css.split(';').filter(Boolean).forEach(rule => {
        const [k, v] = rule.split(':').map(s => s.trim());
        if (k && v) obj[k] = v;
    });
    return obj;
}
