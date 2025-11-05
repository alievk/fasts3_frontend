## Nginx Frontend Proxy for Torrent Player

Use Nginx to expose the static player with optional access controls while forwarding API calls to the torrent backend.

### 1. Build the player bundle

```bash
npm install        # skip if already done
npm run build
```

### 2. Copy assets to the web root

```
rsync -av public/ /var/www/torrent-player/
rsync -av dist/player/ /var/www/torrent-player/dist/player/
```

### 3. Nginx configuration snippet

Create `/etc/nginx/conf.d/torrent-player.conf`:

```
server {
    listen 80;
    server_name player.example.com;

    # Protect access if desired
    # auth_basic "Restricted";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    root /var/www/torrent-player;
    index public/player/index.html;

    location = / {
        return 302 /public/player/;
    }

    location /public/player/ {
        try_files $uri $uri/ /public/player/index.html;
    }

    location /dist/player/ {
        types { }
        default_type application/javascript;
        try_files $uri =404;
    }

    location /api/ {
        proxy_pass http://backend.internal/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Adjust paths, hostnames, and optional auth to match your environment.

### 4. Reload Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

The player now talks to `/api/jobs/{job_id}` without embedding any credentials in the browser. Add extra access controls (mTLS, allowlists, etc.) as needed.
