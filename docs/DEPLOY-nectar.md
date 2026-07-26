# Deploying Carbonator 2 on the Nectar Research Cloud

Carbonator 2 is a pure static site — the smallest Nectar flavor plus nginx is
all it needs. Each step ends with a check; do not continue past a failed check.

## 1. Log in
https://dashboard.rc.nectar.org.au (AAF / university credentials). Check the
project selector top-left. A trial project (pt-xxxxx) works but expires; use a
project allocation for a permanent service.
CHECK: Project -> Compute -> Overview shows your resource usage.

## 2. SSH key
Project -> Compute -> Key Pairs -> Import Public Key. Paste the contents of
`~/.ssh/id_ed25519.pub` (create with `ssh-keygen -t ed25519` if needed).
CHECK: key listed under Key Pairs.

## 3. Security group
Project -> Network -> Security Groups -> Create ("web") -> Manage Rules:
  - SSH  (22)  from your IP range (0.0.0.0/0 works but is noisier)
  - HTTP (80)  from 0.0.0.0/0
  - HTTPS(443) from 0.0.0.0/0
CHECK: the three ingress rules are listed.

## 4. Launch instance
Project -> Compute -> Instances -> Launch Instance:
  - Name: carbonator; any availability zone near you
  - Source: official NeCTAR "Ubuntu 24.04" image
  - Flavor: t3.xsmall (1 VCPU / 1 GB — plenty)
  - Networks: "Classic Provider" if offered (direct public IP)
  - Security groups: default + web;  Key pair: yours
If the assigned IP is private (10.x / 172.x): Network -> Floating IPs ->
Allocate -> Associate with the instance and use that IP instead.
CHECK: instance Active with a public IP (NN.NN.NN.NN below).

## 5. First login
    ssh ubuntu@NN.NN.NN.NN
CHECK: ubuntu@carbonator:~$ prompt.

## 6. System update + nginx + git
    sudo apt update && sudo apt -y upgrade
    sudo apt -y install nginx git
CHECK: `systemctl status nginx` is active, and http://NN.NN.NN.NN shows the
nginx welcome page. If not, the security group / network is wrong — fix that
before continuing.

## 7. Get the repository
    sudo git clone https://github.com/alexsengupta/Carbonator_2.git /var/www/carbonator
CHECK: `ls /var/www/carbonator` shows index.html, js/, data/, assets/.

## 8. nginx site
    sudo tee /etc/nginx/sites-available/carbonator > /dev/null <<'CONF'
    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        server_name _;
        root /var/www/carbonator;
        index index.html;
        location / { try_files $uri $uri/ =404; }
        gzip on;
        gzip_types text/javascript application/javascript text/css text/csv;
        gzip_min_length 1024;
    }
    CONF
    sudo rm /etc/nginx/sites-enabled/default
    sudo ln -s /etc/nginx/sites-available/carbonator /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
CHECK: `nginx -t` ok; `curl -sI http://localhost | head -3` returns 200.

## 9. Test the app
Browse to http://NN.NN.NN.NN — run SSP2-4.5, open Local projections (loads the
large pattern file), visit /explained.html. On errors check
/var/log/nginx/error.log for 404s.

## 10. Updating after new pushes
    ssh ubuntu@NN.NN.NN.NN "cd /var/www/carbonator && sudo git pull"
No build step; nginx serves the new files immediately.

## 11. Optional: DNS + HTTPS
Nectar DNS: Project -> DNS -> Zones (request e.g. yourproject.cloud.edu.au),
add an A record for the instance IP — or point any domain you own at it. Then:
    sudo apt -y install certbot python3-certbot-nginx
    sudo certbot --nginx -d carbonator.yourproject.cloud.edu.au
CHECK: the https:// URL loads with a padlock. Certbot auto-renews.

Notes: Ubuntu 24.04 applies security updates automatically (leave enabled).
Trial projects expire — request a small ongoing allocation for permanence.
