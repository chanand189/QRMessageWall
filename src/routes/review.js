// ─────────────────────────────────────────────────────────────
//  Review routes
//
//  GET /review/:eventId/stats     — event stats + audit log
//  GET /review/:eventId/wordcloud — word frequency data
//  GET /review/:eventId/timeline  — messages per time bucket
//  GET /review/:eventId/export/csv  — download CSV
//  GET /review/:eventId/export/pdf  — download PDF report
// ─────────────────────────────────────────────────────────────
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getHistory }    = require('../services/messageService');
const { getEventStats, getWordCloud, getTimeline } = require('../services/reviewService');
const { getDb }         = require('../lib/prisma');

const router = express.Router();

// All review routes require moderator+
router.use(authenticate, requireRole('moderator', 'admin'));

// ── GET /review/:eventId/stats ────────────────────────────────
router.get('/:eventId/stats', async (req, res) => {
  try {
    const data = await getEventStats({ eventId: req.params.eventId, region: req.user.region });
    res.json(data);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ── GET /review/:eventId/wordcloud ────────────────────────────
router.get('/:eventId/wordcloud', async (req, res) => {
  try {
    const words = await getWordCloud({ eventId: req.params.eventId, region: req.user.region });
    res.json(words);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get word cloud' });
  }
});

// ── GET /review/:eventId/timeline ─────────────────────────────
router.get('/:eventId/timeline', async (req, res) => {
  try {
    const timeline = await getTimeline({ eventId: req.params.eventId, region: req.user.region });
    res.json(timeline);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get timeline' });
  }
});

// ── GET /review/:eventId/export/csv ──────────────────────────
router.get('/:eventId/export/csv', async (req, res) => {
  try {
    const { eventId }    = req.params;
    const region         = req.user.region;
    const includeDeleted = req.query.includeDeleted === 'true';

    const [messages, statsData] = await Promise.all([
      getHistory({ eventId, region, includeDeleted }),
      getEventStats({ eventId, region }),
    ]);

    const eventName = statsData.event?.name || eventId;
    const rows = [
      ['#', 'Message', 'Submitted At', 'Visible', 'Deleted By', 'Deleted At'],
      ...messages.map((m, i) => [
        i + 1,
        `"${(m.content || '').replace(/"/g, '""')}"`,
        new Date(m.createdAt).toLocaleString(),
        m.isVisible ? 'Yes' : 'No',
        m.deletedBy?.username || '',
        m.deletedAt ? new Date(m.deletedAt).toLocaleString() : '',
      ]),
    ];

    const filename = `${eventName.replace(/[^a-z0-9]/gi, '_')}_messages.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.map(r => r.join(',')).join('\n'));
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /review/:eventId/export/pdf ──────────────────────────
router.get('/:eventId/export/pdf', async (req, res) => {
  try {
    const { eventId }    = req.params;
    const region         = req.user.region;
    const includeDeleted = req.query.includeDeleted === 'true';

    const [messages, statsData, wordCloud] = await Promise.all([
      getHistory({ eventId, region, includeDeleted }),
      getEventStats({ eventId, region }),
      getWordCloud({ eventId, region }),
    ]);

    const PDFDocument = require('pdfkit');
    const event       = statsData.event;
    const stats       = statsData.stats;
    const doc         = new PDFDocument({ margin: 50, size: 'A4' });
    const filename    = `${(event?.name || eventId).replace(/[^a-z0-9]/gi, '_')}_report.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // ── Cover ──
    doc.fontSize(28).font('Helvetica-Bold')
       .text('QR Message Wall', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(20).font('Helvetica')
       .text(event?.name || 'Event Report', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#888888')
       .text(`Type: ${event?.type || '—'}   ·   Region: ${region.toUpperCase()}`, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(11)
       .text(`Date: ${event?.startedAt ? new Date(event.startedAt).toLocaleDateString() : '—'}`, { align: 'center' });
    doc.moveDown(2);

    // ── Stats ──
    doc.fillColor('#000000').fontSize(16).font('Helvetica-Bold').text('Summary');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    const statLines = [
      ['Total messages',  stats.totalMessages],
      ['Visible',         stats.visibleMessages],
      ['Deleted',         stats.deletedMessages],
      ['Photos shown',    stats.totalPhotos],
      ['Moderation actions', stats.totalActions],
    ];
    statLines.forEach(([label, val]) => {
      doc.text(`${label}:`, { continued: true, width: 200 })
         .text(` ${val}`, { align: 'left' });
    });
    doc.moveDown(1.5);

    // ── Word cloud (top words) ──
    if (wordCloud.length > 0) {
      doc.fontSize(16).font('Helvetica-Bold').text('Top Words');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      const topWords = wordCloud.slice(0, 20).map(w => `${w.word} (${w.count})`).join('  ·  ');
      doc.text(topWords, { lineGap: 4 });
      doc.moveDown(1.5);
    }

    // ── Messages ──
    doc.fontSize(16).font('Helvetica-Bold').text('All Messages');
    doc.moveDown(0.5);

    const visibleMsgs = includeDeleted ? messages : messages.filter(m => m.isVisible);
    visibleMsgs.forEach((m, i) => {
      if (doc.y > 720) doc.addPage();

      doc.fontSize(9).fillColor('#888888')
         .text(`${i + 1}   ${new Date(m.createdAt).toLocaleString()}${!m.isVisible ? '   [deleted]' : ''}`,
           { lineGap: 2 });
      doc.fontSize(11).fillColor('#000000').font('Helvetica')
         .text(m.content, { lineGap: 4, indent: 12 });
      doc.moveDown(0.4);
    });

    // ── Audit log ──
    if (statsData.actions.length > 0) {
      doc.addPage();
      doc.fontSize(16).font('Helvetica-Bold').text('Moderation Audit Log');
      doc.moveDown(0.5);
      statsData.actions.forEach(a => {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(9).fillColor('#888888')
           .text(`${new Date(a.performedAt).toLocaleString()}   ${a.performedBy?.username || '—'}   ${a.type}`);
        doc.moveDown(0.3);
      });
    }

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
});

module.exports = router;
