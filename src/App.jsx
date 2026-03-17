import React, { useState, useEffect, useRef } from 'react';
import ePub from 'epubjs';
import { pipeline, env } from '@xenova/transformers';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, Play, Mic, MicOff, Menu, ChevronLeft, ChevronRight, 
  X, Bookmark, Trash2, Library, BookOpenText, Loader2, CheckCircle2, Volume2
} from 'lucide-react';
import './App.css';

// AI 环境配置
env.allowLocalModels = false;
env.useBrowserCache = true;

const FONT_OPTIONS = [
  { label: '系统默认', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Georgia (衬线)', value: 'Georgia, serif' },
  { label: 'Arial (无摄线)', value: 'Arial, sans-serif' },
];

const functionWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "so", "yet", "at", "by", "from", "in", "into", "of", "on", "to", "with", "as", "about", "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers", "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs", "this", "that", "these", "those", "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could", "shall", "should", "will", "would", "may", "might", "must"]);

// --- IndexedDB 核心逻辑 ---
const DB_NAME = 'EchoReaderDB';
const STORE_NAME = 'books';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const getBooksFromDB = async () => {
  const db = await openDB();
  return new Promise((resolve) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
  });
};

const deleteBookFromDB = async (id) => {
  const db = await openDB();
  db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
};

function App() {
  const [viewMode, setViewMode] = useState('library');
  const [libraryBooks, setLibraryBooks] = useState([]);
  const [loading, setLoading] = useState(false);

  const [bookBlob, setBookBlob] = useState(null);
  const [book, setBook] = useState(null);
  const [rendition, setRendition] = useState(null);
  const [bookTitle, setBookTitle] = useState('EchoReader');
  const [theme, setTheme] = useState('theme-light');
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState(100);
  const [status, setStatus] = useState('✨ 就绪');
  const [isRecording, setIsRecording] = useState(false);
  const [currentText, setCurrentText] = useState('');
  const [rhythmHTML, setRhythmHTML] = useState('');
  const [comparisonHTML, setComparisonHTML] = useState('');
  const [activeCharIndex, setActiveCharIndex] = useState(-1);

  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [toc, setToc] = useState([]);
  const [showToc, setShowToc] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [popupPos, setPopupPos] = useState(null);

  const viewerRef = useRef(null);
  const transcriberRef = useRef(null);
  const audioChunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      try {
        transcriberRef.current = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          progress_callback: (d) => d.status === 'progress' && d.file.includes('model') && setStatus(`⏳ 下载 AI: ${Math.round(d.progress)}%`)
        });
        setStatus('✨ AI 就绪');
      } catch (e) { setStatus('❌ AI 失败'); }
      loadLibrary();
    };
    init();

    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices().filter(x => x.lang.includes('en-US'));
      setVoices(v);
      if (v.length > 0) setSelectedVoice(v[0].voiceURI);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    const saved = localStorage.getItem('echoreader_local_favs');
    if (saved) setFavorites(JSON.parse(saved));
  }, []);

  useEffect(() => {
    document.body.className = theme;
    if (rendition) {
      rendition.themes.select(theme);
      rendition.themes.font(fontFamily);
    }
  }, [theme, fontFamily, rendition]);

  const generateRhythmHTML = (text, highlightIndex = -1) => {
    if (!text) return '';
    const tokens = text.split(/(\s+|[.,!?;:()"'—])|([a-zA-Z]+(?:'[a-zA-Z]+)?)/).filter(Boolean);
    let runningCharCount = 0;
    return tokens.map(t => {
      const start = runningCharCount;
      runningCharCount += t.length;
      if (!t.trim() || !/[a-zA-Z]/.test(t)) return t;
      const cleanToken = t.toLowerCase();
      const isActive = highlightIndex !== -1 && highlightIndex >= start && highlightIndex < runningCharCount;
      const karaokeClass = isActive ? 'active-word' : '';
      if (functionWords.has(cleanToken)) {
        return `<span class="${karaokeClass}" style="color: #888;">'${cleanToken}</span>`;
      } else {
        return `<u class="${karaokeClass}" style="font-weight: 800; color: var(--primary-color); text-transform: uppercase;">${t}</u>`;
      }
    }).join('');
  };

  useEffect(() => {
    if (currentText) setRhythmHTML(generateRhythmHTML(currentText, activeCharIndex));
  }, [activeCharIndex, currentText]);

  const loadLibrary = async () => {
    const books = await getBooksFromDB();
    const withUrls = books.map(b => ({
      ...b,
      coverUrl: b.coverBlob ? URL.createObjectURL(b.coverBlob) : null
    }));
    setLibraryBooks(withUrls);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const buffer = await file.arrayBuffer();
    const epub = ePub(buffer);
    const meta = await epub.loaded.metadata;
    let coverBlob = null;
    const coverUrl = await epub.coverUrl();
    if (coverUrl) {
      const resp = await fetch(coverUrl);
      coverBlob = await resp.blob();
    }
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
      title: meta.title || file.name,
      author: meta.author || "未知作者",
      blob: new Blob([buffer], { type: file.type }),
      coverBlob: coverBlob
    });
    tx.oncomplete = () => {
      epub.destroy();
      loadLibrary();
      setLoading(false);
    };
  };

  const openBook = (item) => {
    setBookBlob(item.blob);
    setViewMode('reading');
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (viewMode === 'reading' && rendition) {
        if (e.key === 'ArrowRight') rendition.next();
        if (e.key === 'ArrowLeft') rendition.prev();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [viewMode, rendition]);

  useEffect(() => {
    if (viewMode !== 'reading' || !bookBlob) return;
    let rendInstance = null;
    let bookInstance = null;
    const timer = setTimeout(() => {
      if (!viewerRef.current || viewMode !== 'reading') return;
      const container = viewerRef.current;
      container.innerHTML = ''; 
      bookInstance = ePub(bookBlob);
      rendInstance = bookInstance.renderTo(container, {
        width: '100%', height: '100%', spread: 'none', manager: 'continuous', flow: 'paginated'
      });
      const isMobile = window.innerWidth <= 768;
      rendInstance.themes.default({
        'p': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' },
        'div': { 'line-height': isMobile ? '1.25 !important' : '1.6 !important' }
      });
      rendInstance.themes.register('theme-light', { body: { background: '#ffffff', color: '#333' }});
      rendInstance.themes.register('theme-dark', { body: { background: '#121212', color: '#e0e0e0' }});
      rendInstance.themes.select(theme);
      rendInstance.themes.font(fontFamily);
      bookInstance.ready.then(() => {
        const meta = bookInstance.packaging.metadata;
        setBookTitle(meta.title || "未知书籍");
        const key = `echoreader_pos_${meta.title}`;
        const saved = localStorage.getItem(key);
        rendInstance.display(saved || undefined).catch(() => rendInstance.display());
        rendInstance.on('relocated', (loc) => localStorage.setItem(key, loc.start.cfi));
      });
      bookInstance.loaded.navigation.then(nav => setToc(nav.toc || []));
      rendInstance.hooks.content.register((contents) => {
        const body = contents.window.document.body;
        let touchStartX = 0;
        body.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
        body.addEventListener('touchend', (e) => {
          const touchEndX = e.changedTouches[0].clientX;
          const diff = touchEndX - touchStartX;
          const screenWidth = window.innerWidth;
          if (screenWidth <= 768) {
            if (diff < -50) rendInstance.next();
            else if (diff > 50) rendInstance.prev();
            else {
              const clickX = e.changedTouches[0].clientX;
              if (clickX < screenWidth * 0.3) rendInstance.prev();
              else if (clickX > screenWidth * 0.7) rendInstance.next();
            }
          }
        }, { passive: true });
      });
      rendInstance.on('selected', (cfi, contents) => {
        bookInstance.getRange(cfi).then(range => {
          const text = range.toString().trim();
          if (!text) return;
          setCurrentText(text);
          setComparisonHTML(''); 
          const rect = contents.window.getSelection().getRangeAt(0).getBoundingClientRect();
          const iframeRect = contents.document.defaultView.frameElement.getBoundingClientRect();
          setPopupPos({ x: iframeRect.left + rect.left + (rect.width / 2), y: iframeRect.top + rect.top - 10 });
        });
      });
      setBook(bookInstance);
      setRendition(rendInstance);
    }, 400); 
    return () => {
      clearTimeout(timer);
      if (rendInstance) rendInstance.destroy();
      if (bookInstance) bookInstance.destroy();
    };
  }, [viewMode, bookBlob]);

  const syncFavs = (newList) => {
    setFavorites(newList);
    localStorage.setItem('echoreader_local_favs', JSON.stringify(newList));
  };

  const playTTS = () => {
    if (!currentText) return;
    window.speechSynthesis.cancel();
    const ut = new SpeechSynthesisUtterance(currentText);
    const v = voices.find(x => x.voiceURI === selectedVoice);
    if (v) ut.voice = v;
    ut.rate = 0.95;
    ut.onboundary = (event) => event.name === 'word' && setActiveCharIndex(event.charIndex);
    ut.onend = () => setActiveCharIndex(-1);
    ut.onerror = () => setActiveCharIndex(-1);
    window.speechSynthesis.speak(ut);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      if (!currentText || !transcriberRef.current) return;
      setStatus('🎙️ 录音中...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = e => audioChunksRef.current.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const ac = new AudioContext({ sampleRate: 16000 });
        const buf = await ac.decodeAudioData(await blob.arrayBuffer());
        const out = await transcriberRef.current(buf.getChannelData(0));
        const clean = (str) => str.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").trim();
        const originalWords = currentText.split(/(\s+)/);
        const recognizedWords = clean(out.text).split(/\s+/);
        let recIdx = 0;
        const feedback = originalWords.map((token) => {
            if (!token.trim()) return token;
            const cleanToken = clean(token);
            if (!cleanToken) return token;
            let found = false;
            for (let i = recIdx; i < Math.min(recIdx + 4, recognizedWords.length); i++) {
                if (recognizedWords[i] === cleanToken) { found = true; recIdx = i + 1; break; }
            }
            return found ? `<span style="color: #28a745; font-weight: bold; border-bottom: 2px solid #28a745;">${token}</span>` : `<span style="color: #dc3545; text-decoration: line-through; opacity: 0.8;">${token}</span>`;
        });
        setComparisonHTML(feedback.join(''));
        setStatus(`识别完成`);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setIsRecording(true);
    }
  };

  const pageVariants = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };
  const sidebarVariants = { closed: { x: "100%" }, open: { x: 0 } };

  return (
    <div className="app-container">
      <AnimatePresence mode="wait">
        {viewMode === 'library' ? (
          <motion.div key="library" className="bookshelf-container" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <div className="header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Library /> <b>EchoReader 书架</b></div>
              <div className="toolbar">
                <button className="btn btn-fav" onClick={() => setShowFavorites(true)}><Bookmark size={16} /> 收藏夹</button>
                <label className="btn"><Upload size={16} /> 上传<input type="file" accept=".epub" onChange={handleUpload} style={{ display: 'none' }} /></label>
              </div>
            </div>
            <div className="library-status">{status}</div>
            <div className="bookshelf-grid">
              {libraryBooks.map((b, index) => (
                <motion.div key={b.id} className="book-card" onClick={() => openBook(b)} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: { delay: index * 0.05 } }}>
                  <div className="book-cover-wrapper">
                    {b.coverUrl ? <img src={b.coverUrl} className="book-cover" alt="" /> : <div className="no-cover">📖</div>}
                    <button className="btn-delete-book" onClick={(e) => { e.stopPropagation(); deleteBookFromDB(b.id); loadLibrary(); }}><Trash2 size={16} /></button>
                  </div>
                  <div className="book-info"><b>{b.title}</b><p>{b.author}</p></div>
                </motion.div>
              ))}
            </div>
            {loading && <div className="overlay"><Loader2 className="animate-spin" size={48} color="white" /></div>}
          </motion.div>
        ) : (
          <motion.div key="reader" className="reader-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <div className="header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button className="btn btn-icon" onClick={() => { setViewMode('library'); setBookBlob(null); }} title="返回书架"><Library size={20} /></button>
                {/* 🌟 核心修复：去掉了按钮上的 hide-on-mobile，并保持在返回按钮右侧 */}
                <button className="btn btn-icon" onClick={() => setShowToc(true)} title="显示章节"><Menu size={20} /></button>
                <span className="hide-on-mobile"><b>{bookTitle}</b></span>
              </div>
              <div className="toolbar">
                <button className="btn btn-fav" onClick={() => setShowFavorites(true)}><Bookmark size={16} /> 收藏夹</button>
                <select className="select-theme" value={theme} onChange={e => setTheme(e.target.value)}>
                  <option value="theme-light">☀️ 浅色</option>
                  <option value="theme-dark">🌙 深色</option>
                </select>
              </div>
            </div>

            <div className="main-content">
              <button className="nav-btn nav-btn-left hide-on-mobile" onClick={() => rendition?.prev()}><ChevronLeft size={36} /></button>
              <div id="viewer" ref={viewerRef} className={activeCharIndex !== -1 ? 'reading-active' : ''}></div>
              {popupPos && (
                <motion.div className="selection-popup" style={{ left: popupPos.x, top: popupPos.y }} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}>
                  <button className="popup-btn" onClick={() => {
                    const item = { id: Date.now(), text: currentText, book: bookTitle, date: new Date().toLocaleString() };
                    syncFavs([item, ...favorites]);
                    setPopupPos(null);
                  }}>⭐ 收藏</button>
                </motion.div>
              )}
              <button className="nav-btn nav-btn-right hide-on-mobile" onClick={() => rendition?.next()}><ChevronRight size={36} /></button>
            </div>

            <div className="scoring-panel">
              <div className="feedback-container">
                  <div className="feedback-title"><Volume2 size={14} /> 朗读/韵律 {activeCharIndex !== -1 && <span className="karaoke-badge">同步中...</span>}</div>
                  {rhythmHTML && <div className="rhythm-display karaoke-mode" dangerouslySetInnerHTML={{ __html: rhythmHTML }} />}
                  {comparisonHTML && (
                      <><div className="feedback-title" style={{marginTop:'8px'}}><CheckCircle2 size={14} color="#28a745" /> 跟读得分</div>
                      <div className="rhythm-display comparison-display" dangerouslySetInnerHTML={{ __html: comparisonHTML }} /></>
                  )}
              </div>
              <div className="panel-controls">
                <div className="status-text">{status}</div>
                <div className="toolbar">
                  <select className="voice-select" value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)}>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>🇺🇸 {v.name.split(' ')[1] || v.name}</option>)}</select>
                  <button className="btn" onClick={playTTS} style={{ animation: activeCharIndex !== -1 ? 'pulse 1s infinite' : 'none' }}><Play size={16} /> {activeCharIndex !== -1 ? '朗读中' : '标准音'}</button>
                  <button className="btn" onClick={toggleRecording} style={{ background: isRecording ? '#f44' : '#1a73e8' }}><Mic size={16} /> {isRecording ? '结束' : '跟读'}</button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showToc && (
          <><motion.div key="overlay-toc" className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowToc(false)} />
          <motion.div key="sidebar-toc" className="toc-sidebar" variants={sidebarVariants} initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} style={{left:0, right:'auto'}}>
            <div className="toc-header"><b>目录</b><X onClick={() => setShowToc(false)} /></div>
            <div className="toc-content">{toc.map((t, i) => <div key={i} className="toc-item" onClick={() => { rendition.display(t.href); setShowToc(false); }}>{t.label}</div>)}</div>
          </motion.div></>
        )}
        {showFavorites && (
          <><motion.div key="overlay-fav" className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowFavorites(false)} />
          <motion.div key="sidebar-fav" className="fav-sidebar" variants={sidebarVariants} initial="closed" animate="open" exit="closed">
            <div className="toc-header"><b>收藏夹</b><X onClick={() => setShowFavorites(false)} /></div>
            <div className="toc-content">{favorites.length === 0 ? <p style={{textAlign:'center', padding:'20px'}}>暂无内容</p> : 
              favorites.map(f => (<div key={f.id} className="fav-item"><p>{f.text}</p><div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}><small style={{color:'var(--primary-color)'}}>📖 {f.book}</small>辅助<Trash2 size={14} style={{cursor:'pointer', color:'#ff4444'}} onClick={() => syncFavs(favorites.filter(x => x.id !== f.id))} /></div></div>))
            }</div>
          </motion.div></>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;