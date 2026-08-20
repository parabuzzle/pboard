FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    BOARD_DATA_FILE=/data/board.json

WORKDIR /app
COPY package.json server.mjs board-store.mjs linear.mjs app.js index.html styles.css ./
RUN mkdir /data && chown node:node /data

USER node
EXPOSE 4173
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/board').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.mjs"]
