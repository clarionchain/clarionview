#!/bin/sh
# Fix /app/data ownership after Docker volume mount (volumes mount as root).
# This script runs as root, fixes permissions, then drops to nextjs (uid 1001).
chown -R nextjs:nodejs /app/data
exec su-exec nextjs node server.js
