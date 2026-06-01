# Use a lightweight Node image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Install Python and build tools required for compiling native addons (like better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of your application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# The command to start the API
CMD ["node", "app/main.js"]