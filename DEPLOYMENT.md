# Publicacao na DigitalOcean

## DNS

No painel DNS do provedor do dominio, apontar para o IP publico do Droplet:

```text
@    A    <IP_DO_DROPLET>
app  A    <IP_DO_DROPLET>
api  A    <IP_DO_DROPLET>
```

O `www` pode ser um CNAME para `menzzu.com` se for usado.

## Variaveis do backend

Configurar no processo Node, sem commitar o `.env`:

```text
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://app.menzzu.com
PUBLIC_URL=https://api.menzzu.com
GOOGLE_REDIRECT_URI=https://api.menzzu.com/auth/google/callback
FILES_URL=https://files.menzzu.com
```

O host `files.menzzu.com` precisa apontar para o servidor que expõe `/upload.php`, mantendo os caminhos `/marketing`, `/products` e os derivados de imagem.

## Build do frontend

Executar o build com estas variaveis:

```text
VITE_API_URL=https://api.menzzu.com
VITE_PUBLIC_SITE_URL=https://menzzu.com
VITE_FILES_URL=https://files.menzzu.com
```

Publicar o conteudo de `frontend/dist` no virtual host `app.menzzu.com`.

## Nginx

No virtual host da API, encaminhar para o Node:

```nginx
server {
    server_name api.menzzu.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

No virtual host do frontend, usar `root` apontando para o build e fallback para o SPA:

```nginx
server {
    server_name app.menzzu.com;
    root /var/www/zapfly/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Depois emitir o certificado:

```bash
sudo certbot --nginx -d menzzu.com -d www.menzzu.com -d app.menzzu.com -d api.menzzu.com
```

No Google Cloud Console, cadastrar exatamente:

```text
https://api.menzzu.com/auth/google/callback
```
