const outputPanel = document.getElementById('outputPanel');
const consolePanel = document.getElementById('consolePanel');
const outputMeta = document.getElementById('outputMeta');
const diagramPanel = document.getElementById('diagramPanel');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const conversationArea = document.getElementById('conversationArea');
const presetChips = document.getElementById('presetChips');
const suggestedChips = document.getElementById('suggestedChips');
const sessionId = crypto.randomUUID();

function appendConsoleLine(text) {
  if (!consolePanel) return;
  const line = document.createElement('div');
  line.className = 'line';
  const stamp = new Date().toLocaleTimeString();
  line.textContent = `[${stamp}] ${text}`;
  consolePanel.appendChild(line);
  consolePanel.scrollTop = consolePanel.scrollHeight;
}

function resetOutput(prompt) {
  outputPanel.innerHTML = '';
  outputMeta.innerHTML = '';
  diagramPanel.innerHTML = '';
  diagramPanel.classList.add('hidden');
  appendConsoleLine(`You: ${prompt}`);
  if (conversationArea) conversationArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let inCode = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('```')) {
      inCode = !inCode;
      out.push(inCode ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCode) {
      out.push(`${escapeHtml(line)}\n`);
      continue;
    }
    if (line.startsWith('### ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h3>${formatInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h3>${formatInline(line.slice(3))}</h3>`);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${formatInline(line.slice(2))}</li>`);
      continue;
    }
    if (line === '') {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    out.push(`<p>${formatInline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function toMermaidFromFlowSteps(text) {
  const marker = '### Flow Diagram Steps';
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const after = text.slice(start + marker.length);
  const lines = after.split('\n');
  const steps = [];
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    if (m) steps.push(m[1].trim());
    if (line.startsWith('### ') && !line.includes('Flow Diagram Steps')) break;
  }
  if (steps.length < 2) return null;
  const nodes = steps.map((s, i) => `S${i}["${s.replaceAll('"', "'")}"]`);
  const edges = steps.slice(1).map((_, i) => `S${i} --> S${i + 1}`);
  return `flowchart TD\n${nodes.join('\n')}\n${edges.join('\n')}`;
}

async function renderStructuredOutput(text, doneMeta = {}) {
  outputPanel.innerHTML = markdownToHtml(text);
  outputMeta.innerHTML = '';
  const badges = [
    doneMeta.mode ? `mode: ${doneMeta.mode}` : null,
    doneMeta.pipelineStatus ? `status: ${doneMeta.pipelineStatus}` : null,
    doneMeta.confidenceScore ? `confidence: ${doneMeta.confidenceScore}` : null,
    doneMeta.primaryTarget ? `service: ${doneMeta.primaryTarget}` : null,
    Number.isFinite(doneMeta.followUpCalls) ? `mcp calls: ${doneMeta.followUpCalls}` : null,
    Number.isFinite(doneMeta.durationMs) ? `duration: ${doneMeta.durationMs}ms` : null,
  ].filter(Boolean);
  badges.forEach((value) => {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = value;
    outputMeta.appendChild(b);
  });

  const mermaidDef = toMermaidFromFlowSteps(text);
  if (!mermaidDef || !window.mermaid) return;
  diagramPanel.classList.remove('hidden');
  diagramPanel.innerHTML = '<h3>Flow Diagram</h3><div id="mermaidMount"></div>';
  try {
    const { svg } = await window.mermaid.render(`flow_${Date.now()}`, mermaidDef);
    const mount = document.getElementById('mermaidMount');
    if (mount) mount.innerHTML = svg;
  } catch (err) {
    appendConsoleLine(`Mermaid render skipped: ${err.message}`);
  }
}

function makeChip(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.textContent = text;
  btn.addEventListener('click', () => onClick(text));
  return btn;
}

function setChips(container, prompts, onClick) {
  container.innerHTML = '';
  prompts.forEach((prompt) => container.appendChild(makeChip(prompt, onClick)));
}

async function loadPresets() {
  const res = await fetch('/api/presets');
  if (!res.ok) return;
  const data = await res.json();
  setChips(presetChips, data.predefinedPrompts || [], (text) => {
    messageInput.value = text;
  });
  setChips(suggestedChips, data.fallbackSuggestedPrompts || [], (text) => {
    messageInput.value = text;
  });
}

async function sendMessage(message) {
  sendBtn.disabled = true;
  resetOutput(message);
  let finalText = '';

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Streaming request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingEvent = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex = buffer.indexOf('\n\n');
      while (sepIndex !== -1) {
        const block = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        let eventName = pendingEvent;
        const dataLines = [];
        block.split('\n').forEach((line) => {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        });

        if (dataLines.length > 0) {
          const payload = JSON.parse(dataLines.join('\n'));
          if (eventName === 'log') {
            appendConsoleLine(payload.message || 'Processing...');
          } else if (eventName === 'chunk') {
            finalText += payload.chunk || '';
            outputPanel.textContent = finalText;
            outputPanel.scrollTop = outputPanel.scrollHeight;
          } else if (eventName === 'done') {
            if (payload.error) {
              appendConsoleLine(`Error: ${payload.error}`);
              outputPanel.textContent = `Error: ${payload.error}`;
            } else {
              appendConsoleLine(
                `Completed. mode=${payload.mode}, status=${payload.pipelineStatus}, duration=${payload.durationMs}ms`,
              );
              setChips(suggestedChips, payload.suggestedPrompts || [], (text) => {
                messageInput.value = text;
              });
              await renderStructuredOutput(finalText, payload);
            }
          }
        }
        pendingEvent = 'message';
        sepIndex = buffer.indexOf('\n\n');
      }
    }
  } catch (err) {
    appendConsoleLine(`Error: ${err.message}`);
    outputPanel.textContent = `Error: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
  }
}

function autoResizeInput() {
  if (!messageInput) return;
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;
  messageInput.value = '';
  await sendMessage(message);
});

messageInput.addEventListener('input', autoResizeInput);
autoResizeInput();

loadPresets();
