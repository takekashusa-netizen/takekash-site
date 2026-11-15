# takekash site on Railway (static pages + API). Netlify ignores this file.
FROM node:22-slim
WORKDIR /app
COPY . .
# Netlify Blobs -> files on the /data volume (same API, see server/blobs-shim)
RUN rm -rf node_modules && mkdir -p node_modules/@netlify && cp -r server/blobs-shim node_modules/@netlify/blobs
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "server/server.mjs"]
