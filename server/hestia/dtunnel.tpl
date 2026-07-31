#=========================================================================#
# dtunnel — HestiaCP proxy template (HTTP)                                 #
# Apex → Apache. Wildcard → gateway nativo :18080.                                          #
#=========================================================================#

server {
        listen      %ip%:%proxy_port%;
        server_name %domain_idn%;
        error_log   /var/log/%web_system%/domains/%domain%.error.log error;

        include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;

        location ~ /\.(?!well-known\/|file) {
                deny all;
                return 404;
        }

        location /api/ {
                proxy_pass http://127.0.0.1:3001/;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
                proxy_read_timeout 3600s;
                proxy_send_timeout 3600s;
        }

        location /tunnel/ {
                proxy_pass http://127.0.0.1:3001/tunnel/;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
                proxy_read_timeout 3600s;
                proxy_send_timeout 3600s;
        }

        location / {
                proxy_pass http://%ip%:%web_port%;
                proxy_http_version 1.1;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /error/ {
                alias %home%/%user%/web/%domain%/document_errors/;
        }

        include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}

server {
        listen      %ip%:%proxy_port%;
        server_name %alias_idn%;
        error_log   /var/log/%web_system%/domains/%domain%.error.log error;

        include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;

        location ~ /\.(?!well-known\/|file) {
                deny all;
                return 404;
        }

        location / {
                proxy_pass http://127.0.0.1:18080;
                proxy_http_version 1.1;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection $http_connection;
                proxy_read_timeout 3600s;
                proxy_send_timeout 3600s;
        }

        location /error/ {
                alias %home%/%user%/web/%domain%/document_errors/;
        }

        include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
