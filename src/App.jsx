import React, { useState, useEffect, useRef } from 'react';
import ePub from 'epubjs';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, Play, Pause, Square, Menu, ChevronLeft, ChevronRight, 
  X, Bookmark, Trash2, Library, Volume2, Loader2, Sparkles
} from 'lucide-react';
import './App.css';

// ⚠️ 注意：这里已经删除了对 @google/generative-ai 的 import
// ⚠️ 注意：这里已经删除了 GEMINI_API_KEY 变量

const functionWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "so", "yet", "at", "by", "from", "in", "into", "of", "on", "to", "with", "as", "about", "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his", "she", "her", "hers", "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs", "this", "that", "these", "those", "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could", "shall", "should", "will", "would", "may", "might", "must"]);

const DB_NAME = 'EchoReaderDB';
const STORE_NAME = 'books';

const openDB = () => {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
  });
};

const deleteBookFromDB = async (id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
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
  
  const [fontSize, setFontSize] = useState(() => {
    const savedSize = localStorage.getItem('echoreader_font_size');
    return savedSize ? parseInt(savedSize, 10) : 16;
  });
  
  const [pageText, setPageText] = useState(''); 
  const [currentText, setCurrentText] = useState(''); 
  const [rhythmHTML, setRhythmHTML] = useState('');
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);

  const [bottomTab, setBottomTab] = useState('tts'); 
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [toc, setToc] = useState([]);
  const [showToc, setShowToc] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [popupPos, setPopupPos] = useState(null);

  const viewerRef = useRef(null);
  const rhythmRef = useRef(null);
  const utterancesRef = useRef([]); 

  useEffect(() => {
    const saved = localStorage.getItem('echoreader_local_favs');
    if (saved) setFavorites(JSON.parse(saved));
    loadLibrary();
    window.speechSynthesis.getVoices(); 

    const handleGlobalClick = (e) => {
      if (!e.target.closest('.selection-popup')) {
        const sel = window.getSelection();
        if (!sel || sel.toString().trim().length === 0) {
          setPopupPos(null);
        }
      }
    };
    document.addEventListener('pointerdown', handleGlobalClick);
    return () => {
      window.speechSynthesis.cancel();
      document.removeEventListener('pointerdown', handleGlobalClick);
    };
  }, []);

  useEffect(() => {
    document.body.className = theme;
    if (rendition) rendition.themes.select(theme);
  }, [theme, rendition]);

  useEffect(() => {
    if (rendition) {
      rendition.themes.fontSize(`${fontSize}px`);
      localStorage.setItem('echoreader_font_size', fontSize.toString());
    }
  }, [fontSize, rendition]);

  const loadLibrary = async () => {
    const db = await openDB();
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      setLibraryBooks(request.result.map(b => ({
        ...b, coverUrl: b.coverBlob ? URL.createObjectURL(b.coverBlob) : null
      })));
    };
  };

  const openBook = (item) => {
    setBookBlob(item.blob);
    setViewMode('reading');
  };

  const extractPageText = async (rendInstance, bookInstance) => {
    try {
      const loc = rendInstance.currentLocation();
      if (!loc || !loc.start || !loc.end) {
        setPageText("（无法获取页面位置）");
        return "";
      }

      const startRange = await bookInstance.getRange(loc.start.cfi);
      const endRange = await bookInstance.getRange(loc.end.cfi);

      if (startRange && endRange) {
        const doc = startRange.startContainer.ownerDocument;
        const pageRange = doc.createRange();
        
        pageRange.setStart(startRange.startContainer, startRange.startOffset);
        pageRange.setEnd(endRange.endContainer, endRange.endOffset);
        
        const text = pageRange.toString().replace(/\s+/g, ' ').trim();
        setPageText(text || "（当前页面可能为图片或无文字区域）");
        return text;
      }
    } catch (err) {
      console.error("页面文本抓取失败:", err);
      setPageText("（文本解析失败）");
      return "";
    }
  };

  const generateRhythmHTML = (text, highlightIndex = -1) => {
    if (!text) return '';
    const tokens = text.split(/([a-zA-Z]+(?:'[a-zA-Z]+)?|\s+|[^\w\s])/g).filter(Boolean);
    let runningCharCount = 0;

    return tokens.map((token, i) => {
      const start = runningCharCount;
      runningCharCount += token.length;
      
      const isActive = highlightIndex !== -1 && highlightIndex >= start && highlightIndex < runningCharCount;
      const highlightClass = isActive ? 'active-word-glow' : '';

      if (/^[a-zA-Z]+/.test(token)) {
        const cleanToken = token.toLowerCase();
        if (functionWords.has(cleanToken)) {
          return `<span key="${i}" class="${highlightClass}" style="color: var(--rhythm-grey);">'${cleanToken}</span>`;
        } else {
          return `<span key="${i}" class="${highlightClass}" style="font-weight: 800; color: var(--primary-color); text-transform: uppercase;">${token}</span>`;
        }
      }
      return `<span key="${i}" class="${highlightClass}">${token}</span>`;
    }).join('');
  };

  useEffect(() => {
    const targetText = currentText || pageText;
    setRhythmHTML(generateRhythmHTML(targetText, activeCharIndex));
  }, [activeCharIndex, pageText, currentText]);

  useEffect(() => {
    if (rhythmRef.current && activeCharIndex !== -1 && bottomTab === 'tts') {
      const activeEl = rhythmRef.current.querySelector('.active-word-glow');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeCharIndex, bottomTab]);

  const handlePlay = async () => {
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();

    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    setActiveCharIndex(-1);
    setBottomTab('tts'); 

    let textToRead = currentText || pageText;

    if (!textToRead || textToRead.startsWith("⏳")) {
      setPageText("⏳ 正在获取当前页面文本...");
      textToRead = await extractPageText(rendition, book);
    }

    if (!textToRead || textToRead.startsWith("（无法获取") || textToRead.startsWith("（当前页面")) {
      alert("⚠️ 未能提取到当前页面的文字。请尝试往后翻一页，或手动高亮划选一段文字后再试。");
      return;
    }
    
    setTimeout(() => {
      const blocks = textToRead.match(/[^.?!。？！\n]+[.?!。？！\n]*/g) || [textToRead];
      
      let currentOffset = 0;
      utterancesRef.current = []; 

      blocks.forEach((block, index) => {
        if (!block.trim()) {
           currentOffset += block.length;
           return; 
        }

        const ut = new SpeechSynthesisUtterance(block);
        const isZh = /[\u4e00-\u9fa5]/.test(block); 

        ut.lang = isZh ? 'zh-CN' : 'en-US';
        ut.rate = 0.95; 

        const blockOffset = currentOffset;
        currentOffset += block.length;

        ut.onstart = () => { 
          setIsSpeaking(true); 
          setIsPaused(false); 
          setActiveCharIndex(blockOffset); 
        };
        
        ut.onboundary = (event) => {
          if (event.name === 'word') {
            setActiveCharIndex(blockOffset + event.charIndex);
          }
        };

        ut.onend = () => {
          if (index === blocks.length - 1) {
            setIsSpeaking(false); setIsPaused(false); setActiveCharIndex(-1);
          }
        };

        ut.onerror = (e) => { 
          console.error("朗读引擎出错:", e); 
          setIsSpeaking(false); setIsPaused(false); setActiveCharIndex(-1); 
        };

        utterancesRef.current.push(ut);
        window.speechSynthesis.speak(ut);
      });
    }, 100);
  };

  const handlePause = () => {
    if (window.speechSynthesis.speaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const handleStop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setActiveCharIndex(-1);
  };

  // 🌟 修改：使用 fetch 调用云端函数，而不是直接调用大模型 API
  const handleAIAnalyze = async () => {
    const targetText = currentText || pageText;
    
    if (!targetText || targetText.startsWith("（无法获取") || targetText.includes("⏳")) {
      alert("请先确保页面已加载完毕，或选中一段文本。");
      return;
    }

    setBottomTab('ai'); 
    setIsAnalyzing(true);
    setAiAnalysis("⏳ 正在呼叫云端 AI 进行深度解析，请稍候...");

    try {
      const prompt = `
      你是一个资深的英语阅读伴读助手。请阅读以下英文段落，并提供：
      1. 【本段总结】：用一句精炼的中文总结这段话的核心情节。
      2. 【疑难词汇与句型】：提取 3-5 个对非母语者较难的单词、地道短语或美式俚语。给出它们在**当前上下文**中的准确中文释义。
      请用清晰的排版输出，加粗核心词汇。
      3. 如果待分析文本是中文，则请提供相应的符合**当前上下文**的英文翻译。
	  4. 不要在开头介绍你自己，直接给出回答。
      d
      待分析文本：
      ${targetText}
      `;

      // 发送 POST 请求到你的 Netlify 云函数
	  // 假设你的 Netlify 域名是 echoreader-backend.netlify.app
	const response = await fetch('https://fascinating-sprite-42e8d0.netlify.app', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ text: prompt })
	});

      if (!response.ok) {
        throw new Error(`请求失败，状态码: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.error) {
         throw new Error(data.error);
      }
      
      setAiAnalysis(data.reply);

    } catch (error) {
      console.error("AI 分析失败:", error);
      setAiAnalysis(`❌ 解析失败，请检查网络或后端部署配置。错误信息: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatAIResult = (text) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<b style="color: var(--primary-color)">$1</b>')
      .replace(/\n/g, '<br/>');
  };

  const handleLocalSelection = () => {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      
      const text = selection.toString().trim();
      if (text.length > 0) {
        setCurrentText(text); 
        
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        setPopupPos({
          x: rect.left + (rect.width / 2),
          y: rect.top - 10
        });
      }
    }, 50);
  };

  useEffect(() => {
    if (viewMode !== 'reading' || !bookBlob) return;

    let rendInstance = null;
    let bookInstance = null;
    let isMounted = true;

    const timer = setTimeout(async () => {
      if (!viewerRef.current || viewMode !== 'reading' || !isMounted) return;
      viewerRef.current.innerHTML = ''; 

      try {
        const buffer = await bookBlob.arrayBuffer();
        if (!isMounted) return;

        bookInstance = ePub(buffer);
        rendInstance = bookInstance.renderTo(viewerRef.current, {
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

        rendInstance.themes.fontSize(`${fontSize}px`);

        bookInstance.ready.then(() => {
          setBook(bookInstance);
          const meta = bookInstance.packaging.metadata;
          setBookTitle(meta.title || "未知书籍");
          const key = `echoreader_pos_${meta.title}`;
          
          rendInstance.display(localStorage.getItem(key) || undefined).then(() => {
            extractPageText(rendInstance, bookInstance);
          });

          bookInstance.loaded.navigation.then(nav => {
            setToc(nav.toc || []);
          });

          rendInstance.on('relocated', (loc) => {
            localStorage.setItem(key, loc.start.cfi);
            setCurrentText(''); 
            handleStop(); 
            extractPageText(rendInstance, bookInstance); 
          });
        });

        rendInstance.hooks.content.register((contents) => {
          const body = contents.window.document.body;
          let touchStartX = 0;
          body.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
          body.addEventListener('touchend', (e) => {
            const diff = e.changedTouches[0].clientX - touchStartX;
            if (window.innerWidth <= 768) {
              if (diff < -50) rendInstance.next();
              if (diff > 50) rendInstance.prev();
            }
          }, { passive: true });
        });

        rendInstance.on('selected', (cfi, contents) => {
          bookInstance.getRange(cfi).then(range => {
            const text = range.toString().trim();
            if (!text) return;
            setCurrentText(text);
            handleStop(); 
            const rect = contents.window.getSelection().getRangeAt(0).getBoundingClientRect();
            const iframeRect = contents.document.defaultView.frameElement.getBoundingClientRect();
            setPopupPos({ x: iframeRect.left + rect.left + (rect.width / 2), y: iframeRect.top + rect.top - 10 });
          });
        });

        rendInstance.on('click', (e) => {
          setPopupPos(null);
          
          const sel = e.view.document.getSelection();
          if (sel && sel.toString().trim().length > 0) return;
          
          setCurrentText('');

          const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
          if (isTouchDevice && window.innerWidth <= 1024) {
            const screenWidth = e.view.innerWidth;
            if (e.clientX < screenWidth * 0.35) rendInstance.prev();
            else if (e.clientX > screenWidth * 0.65) rendInstance.next();
          }
        });

        setRendition(rendInstance);
      } catch (err) {
        console.error("书籍渲染失败: ", err);
      }
    }, 400); 

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (rendInstance) rendInstance.destroy();
      if (bookInstance) bookInstance.destroy();
    };
  }, [viewMode, bookBlob]);

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

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const buffer = await file.arrayBuffer();
    const epub = ePub(buffer);
    const meta = await epub.loaded.metadata;
    let coverBlob = null;
    const coverUrl = await epub.coverUrl();
    if (coverUrl) { const resp = await fetch(coverUrl); coverBlob = await resp.blob(); }
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ title: meta.title || file.name, blob: new Blob([buffer]), coverBlob });
    tx.oncomplete = () => { epub.destroy(); loadLibrary(); setLoading(false); };
  };

  const syncFavs = (newList) => {
    setFavorites(newList);
    localStorage.setItem('echoreader_local_favs', JSON.stringify(newList));
  };

  const pageVariants = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };
  const sidebarVariants = { closed: { x: "100%" }, open: { x: 0 } };

  return (
    <div className="app-container">
      <AnimatePresence mode="wait">
        {viewMode === 'library' ? (
          <motion.div key="library" className="bookshelf-container" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <div className="header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Library /> <b>EchoReader</b></div>
              <div className="toolbar">
                <select className="select-theme" value={theme} onChange={e => setTheme(e.target.value)}>
                  <option value="theme-light">☀️ 浅色</option>
                  <option value="theme-dark">🌙 深色</option>
                </select>
                <button className="btn btn-fav" onClick={() => setShowFavorites(true)} style={{backgroundColor: '#FF9900', color: '#000'}}><Bookmark size={16} /> 收藏</button>
                <label className="btn">
                  <Upload size={16} /> 上传
                  <input type="file" accept=".epub" onChange={handleUpload} style={{ display: 'none' }} />
                </label>
              </div>
            </div>
            <div className="bookshelf-grid">
              {libraryBooks.map((b, index) => (
                <motion.div key={b.id} className="book-card" onClick={() => {openBook(b); handleStop();}} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: { delay: index * 0.05 } }}>
                  <div className="book-cover-wrapper">
                    {b.coverUrl ? <img src={b.coverUrl} className="book-cover" alt="" /> : <div className="no-cover">📖</div>}
                    <button className="btn-delete-book" onClick={async (e) => { 
                      e.stopPropagation(); 
                      try {
                        await deleteBookFromDB(b.id); 
                        await loadLibrary(); 
                      } catch(err) { console.error(err); }
                    }}><Trash2 size={16} /></button>
                  </div>
                  <div className="book-info"><b>{b.title}</b></div>
                </motion.div>
              ))}
            </div>
            {loading && <div className="overlay"><Loader2 className="animate-spin" size={48} color="white" /></div>}
          </motion.div>
        ) : (
          <motion.div key="reader" className="reader-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            
            <div className="header" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <button className="btn btn-icon" onClick={() => { setViewMode('library'); setBookBlob(null); handleStop(); }} title="返回"><Library size={20} /></button>
                <button className="btn btn-icon" onClick={() => setShowToc(true)} title="目录"><Menu size={20} /></button>
              </div>
              
              <div className="control-toolbar" style={{ display: 'flex', gap: '8px', flex: 1, justifyContent: 'center' }}>
                {!isSpeaking || isPaused ? (
                  <button className="btn btn-control" onClick={handlePlay}>
                    <Play size={16} /> <span className="hide-on-mobile">{currentText ? '读选区' : '自动朗读'}</span>
                  </button>
                ) : (
                  <button className="btn btn-control" style={{ backgroundColor: '#FF9900', color: '#000' }} onClick={handlePause}>
                    <Pause size={16} /> <span className="hide-on-mobile">暂停</span>
                  </button>
                )}
                {(isSpeaking || isPaused) && (
                  <button className="btn btn-control dark" onClick={handleStop}>
                    <Square size={16} /> <span className="hide-on-mobile">停止</span>
                  </button>
                )}

                <button className="btn btn-control" style={{ backgroundColor: '#673ab7', color: 'white' }} onClick={handleAIAnalyze} disabled={isAnalyzing}>
                  {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} 
                  <span className="hide-on-mobile">AI 分析</span>
                </button>
              </div>

              <div className="toolbar" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ display: 'flex', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                  <button 
                    onClick={() => setFontSize(s => Math.max(12, s - 2))} 
                    style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-color)', borderRight: '1px solid var(--border-color)', fontSize: '14px', fontWeight: 'bold' }}
                    title="缩小字体"
                  >A-</button>
                  <button 
                    onClick={() => setFontSize(s => Math.min(32, s + 2))} 
                    style={{ border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-color)', fontSize: '14px', fontWeight: 'bold' }}
                    title="放大字体"
                  >A+</button>
                </div>
                
                <select className="select-theme" value={theme} onChange={e => setTheme(e.target.value)}>
                  <option value="theme-light">☀️ 浅色</option>
                  <option value="theme-dark">🌙 深色</option>
                </select>
              </div>
            </div>

            <div className="main-content">
              <button className="nav-btn nav-btn-left hide-on-mobile" onClick={() => rendition?.prev()}><ChevronLeft size={36} /></button>
              <div id="viewer" ref={viewerRef}></div>
              <button className="nav-btn nav-btn-right hide-on-mobile" onClick={() => rendition?.next()}><ChevronRight size={36} /></button>
            </div>

            <div className="scoring-panel">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                <div style={{display: 'flex', gap: '15px'}}>
                  <div 
                    onClick={() => setBottomTab('tts')}
                    style={{ cursor: 'pointer', fontSize: '13px', fontWeight: bottomTab === 'tts' ? 'bold' : 'normal', color: bottomTab === 'tts' ? 'var(--primary-color)' : '#888', borderBottom: bottomTab === 'tts' ? '2px solid var(--primary-color)' : 'none', paddingBottom: '4px' }}
                  >
                    <Volume2 size={14} style={{verticalAlign: 'middle', marginRight: '4px'}}/> 
                    实时朗读
                    {activeCharIndex !== -1 && bottomTab === 'tts' && <span className="karaoke-badge">播放中</span>}
                  </div>
                  <div 
                    onClick={() => setBottomTab('ai')}
                    style={{ cursor: 'pointer', fontSize: '13px', fontWeight: bottomTab === 'ai' ? 'bold' : 'normal', color: bottomTab === 'ai' ? 'var(--primary-color)' : '#888', borderBottom: bottomTab === 'ai' ? '2px solid var(--primary-color)' : 'none', paddingBottom: '4px' }}
                  >
                    <Sparkles size={14} style={{verticalAlign: 'middle', marginRight: '4px'}}/> 
                    AI 伴读
                  </div>
                </div>
              </div>
              
              {bottomTab === 'tts' ? (
                <div 
                  ref={rhythmRef}
                  className="rhythm-display karaoke-mode" 
                  dangerouslySetInnerHTML={{ __html: rhythmHTML || "<p style='color:var(--text-color); opacity: 0.6; text-align:center; font-size:14px; margin:0;'>准备朗读... 点击上方自动朗读或划选文字</p>" }} 
                />
              ) : (
                <div 
                  className="rhythm-display ai-mode" 
                  onMouseUp={handleLocalSelection}
                  onTouchEnd={handleLocalSelection}
                  onMouseDown={() => setPopupPos(null)} 
                  dangerouslySetInnerHTML={{ __html: aiAnalysis ? formatAIResult(aiAnalysis) : "<p style='color:var(--text-color); opacity: 0.6; text-align:center; font-size:14px; margin:0;'>点击上方【AI 分析】按钮，获取当前段落的智能总结与疑难词汇解析。</p>" }} 
                />
              )}
            </div>
            
            {popupPos && (
                <motion.div 
                  className="selection-popup" 
                  style={{ 
                    position: 'fixed', 
                    left: popupPos.x, 
                    top: popupPos.y,
                    transform: 'translate(-50%, -100%)', 
                    zIndex: 9999 
                  }} 
                  initial={{ opacity: 0, scale: 0.5 }} 
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <button className="popup-btn" onClick={() => {
                    const item = { id: Date.now(), text: currentText, book: bookTitle, date: new Date().toLocaleString() };
                    syncFavs([item, ...favorites]);
                    setPopupPos(null);
                    window.getSelection()?.removeAllRanges(); 
                  }}>⭐ 收藏</button>
                </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showToc && (
          <><motion.div className="overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setShowToc(false)} />
          <motion.div className="toc-sidebar" variants={sidebarVariants} initial="closed" animate="open" exit="closed" style={{left:0, right:'auto'}}>
            <div className="toc-header"><b>目录</b><X onClick={()=>setShowToc(false)} /></div>
            <div className="toc-content">{toc.map((t, i) => <div key={i} className="toc-item" onClick={()=>{rendition.display(t.href); setShowToc(false)}}>{t.label}</div>)}</div>
          </motion.div></>
        )}
        {showFavorites && (
          <><motion.div className="overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setShowFavorites(false)} />
          <motion.div className="fav-sidebar" variants={sidebarVariants} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}>
            <div className="toc-header"><b>收藏夹</b><X onClick={()=>setShowFavorites(false)} /></div>
            <div className="toc-content">{favorites.length === 0 ? <p style={{textAlign:'center', padding:'20px'}}>暂无内容</p> : 
              favorites.map(f => (<div key={f.id} className="fav-item"><p>{f.text}</p><div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}><small style={{color:'var(--primary-color)'}}>📖 {f.book}</small><Trash2 size={14} style={{cursor:'pointer', color:'#ff4444'}} onClick={() => syncFavs(favorites.filter(x => x.id !== f.id))} /></div></div>))
            }</div>
          </motion.div></>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;