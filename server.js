/**
 * Xolo LaTeX Compile Service
 * 
 * A simple LaTeX to PDF compilation service that can be deployed
 * to any hosting platform that supports Node.js or Docker.
 * 
 * Usage:
 *   POST /compile
 *   Body: { files: [{ path: "main.tex", content: "..." }] }
 *   Returns: PDF binary
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Find pdflatex executable
function findPdfLatex() {
  const possiblePaths = [
    'pdflatex',
    // Windows paths
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'pdflatex.exe'),
    'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\pdflatex.exe',
    'C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\x64\\pdflatex.exe',
    // Linux paths
    '/usr/bin/pdflatex',
    '/usr/local/bin/pdflatex',
    // macOS paths
    '/Library/TeX/texbin/pdflatex',
    '/usr/local/texlive/2023/bin/universal-darwin/pdflatex',
  ];
  
  for (const p of possiblePaths) {
    try {
      if (p === 'pdflatex') {
        execSync('pdflatex --version', { stdio: 'ignore' });
        return 'pdflatex';
      } else if (fs.existsSync(p)) {
        return process.platform === 'win32' ? `"${p}"` : p;
      }
    } catch (e) {
      // Continue to next
    }
  }
  return null;
}

const PDFLATEX = findPdfLatex();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    latexInstalled: !!PDFLATEX,
    platform: process.platform,
    nodeVersion: process.version
  });
});

// Compile endpoint
app.post('/compile', async (req, res) => {
  const requestId = uuidv4();
  const startTime = Date.now();
  
  console.log(`[${requestId}] Starting compile...`);

  // Set timeout
  const TIMEOUT_MS = 120000; // 2 minutes

  try {
    const { files = [], projectId, lastModifiedFile } = req.body;
    
    if (!files.length) {
      return res.status(400).json({ error: 'No files provided' });
    }

    if (!PDFLATEX) {
      return res.status(503).json({ 
        error: 'LaTeX not found',
        details: 'Please install MiKTeX (Windows) or TeX Live (macOS/Linux)',
        suggestion: 'For local development, install MiKTeX from https://miktex.org'
      });
    }

    // Find main .tex file
    const mainFile = files.find(f => f.path.endsWith('.tex'));
    if (!mainFile) {
      return res.status(400).json({ error: 'No .tex file provided' });
    }

    // Create temp directory
    const tmpDir = path.join(os.tmpdir(), `latex-${requestId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write all files to temp dir
    for (const file of files) {
      // Handle escaped newlines from JSON
      let content = file.content;
      if (content.includes('\\n')) {
        content = content.replace(/\\n/g, '\n');
      }
      if (content.includes('\\r\\n')) {
        content = content.replace(/\\r\\n/g, '\n');
      }
      
      const filePath = path.join(tmpDir, file.path);
      const fileDir = path.dirname(filePath);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
    }

    const texFileName = path.basename(mainFile.path);
    const texFilePath = path.join(tmpDir, texFileName);

    console.log(`[${requestId}] Compiling ${texFileName} in ${tmpDir}`);

    // Run pdflatex with multiple passes for cross-references
    try {
      // First pass
      execSync(`${PDFLATEX} -interaction=nonstopmode -halt-on-error "${texFilePath}"`, {
        cwd: tmpDir,
        stdio: 'pipe',
        timeout: TIMEOUT_MS
      });

      // Second pass for cross-references
      execSync(`${PDFLATEX} -interaction=nonstopmode -halt-on-error "${texFilePath}"`, {
        cwd: tmpDir,
        stdio: 'pipe',
        timeout: TIMEOUT_MS
      });

      // Try third pass if needed
      try {
        execSync(`${PDFLATEX} -interaction=nonstopmode -halt-on-error "${texFilePath}"`, {
          cwd: tmpDir,
          stdio: 'pipe',
          timeout: TIMEOUT_MS
        });
      } catch (e) {
        // Third pass failed, but that's ok - document might not have references
      }

    } catch (compileError) {
      console.error(`[${requestId}] Compile error:`, compileError.message);
      
      // Try to get log file
      const logFile = path.join(tmpDir, texFileName.replace('.tex', '.log'));
      let errorDetails = compileError.message;
      
      if (fs.existsSync(logFile)) {
        const log = fs.readFileSync(logFile, 'utf8');
        const lines = log.split('\n');
        const errorStart = lines.findIndex(l => l.includes('Here is how much of TeX'));
        if (errorStart >= 0) {
          errorDetails = lines.slice(errorStart, errorStart + 20).join('\n');
        }
      }
      
      fs.rmSync(tmpDir, { recursive: true, force: true });
      
      return res.status(500).json({ 
        error: 'LaTeX compilation failed',
        details: errorDetails,
        requestId,
        durationMs: Date.now() - startTime
      });
    }

    // Find the PDF
    const pdfBaseName = texFileName.replace('.tex', '.pdf');
    const pdfPath = path.join(tmpDir, pdfBaseName);

    if (fs.existsSync(pdfPath)) {
      const pdfBuffer = fs.readFileSync(pdfPath);
      const durationMs = Date.now() - startTime;
      
      console.log(`[${requestId}] PDF compiled successfully in ${durationMs}ms`);

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });

      // Return PDF with headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Compile-Request-Id', requestId);
      res.setHeader('X-Compile-Duration-Ms', durationMs);
      res.send(pdfBuffer);
    } else {
      // Check for log file errors
      const logFile = path.join(tmpDir, texFileName.replace('.tex', '.log'));
      let errorMsg = 'PDF not generated';
      
      if (fs.existsSync(logFile)) {
        const log = fs.readFileSync(logFile, 'utf8');
        const errorLines = log.split('\n').filter(l => l.includes('Error') || l.includes('!'));
        if (errorLines.length > 0) {
          errorMsg = errorLines.slice(0, 5).join('\n');
        }
      }
      
      fs.rmSync(tmpDir, { recursive: true, force: true });
      
      return res.status(500).json({ 
        error: errorMsg,
        requestId,
        suggestion: 'Check your LaTeX syntax'
      });
    }

  } catch (error) {
    console.error(`[${requestId}] Server error:`, error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: String(error),
      requestId
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Xolo LaTeX Compile Service running on port ${PORT}`);
  console.log(`LaTeX executable: ${PDFLATEX || 'NOT FOUND'}`);
});
