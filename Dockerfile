# Build stage: install all dependencies and compile TypeScript.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY assets ./assets
RUN npm run build

# Runtime stage: production dependencies and compiled output only.
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY assets/facilities.json ./assets/facilities.json
USER node
EXPOSE 3000
# Run node directly, not through npm, so SIGTERM reaches the app and shutdown is clean.
CMD ["node", "dist/src/server.js"]
