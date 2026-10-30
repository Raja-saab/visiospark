# Lab guide: VisioSpark CI/CD on Jenkins + Minikube, monitored by Grafana

Design choice for Task 1: ONE large server (c7i-flex.large, 2 vCPU / 4 GB) running Jenkins, Docker and Minikube.
Task 2: a SECOND instance running Prometheus + Grafana that watches server 1.

```
GitHub --webhook--> Jenkins (server 1) --build/test--> Docker images --> Minikube (Kubernetes)
                                                                     frontend(Nginx) -> backend(Node) -> db(PostgreSQL)
Server 2: Grafana + Prometheus  --scrapes-->  server 1 (node exporter :9100, Jenkins :8080/prometheus)
```

## Part A. Server 1 (Jenkins + Minikube)

### A1. Launch the instance
- AWS EC2, Ubuntu, type **c7i-flex.large**, 20 GB disk.
- Security group inbound: 22 (SSH), 8080 (Jenkins), 30080 (app), 9100 (node exporter, source = server 2 IP).

### A2. Swap (the 4 GB RAM is tight with Jenkins + Minikube)
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

### A3. Install Java and Jenkins
(same as the earlier lab)
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y fontconfig openjdk-21-jre
sudo wget -O /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt update && sudo apt install -y jenkins
sudo systemctl enable --now jenkins
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```
Open `http://<server1-ip>:8080`, unlock, install suggested plugins.

### A4. Install Docker, Node, kubectl, Minikube, socat, node exporter
```bash
sudo apt install -y docker.io nodejs npm socat curl conntrack prometheus-node-exporter
sudo usermod -aG docker jenkins
sudo usermod -aG docker ubuntu

curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl

curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```
Log out and back in (so the ubuntu user gets the docker group).

### A5. Start Minikube AS THE JENKINS USER
Jenkins runs the pipeline, so Minikube/kubeconfig must belong to the `jenkins` user.
```bash
sudo systemctl restart jenkins
sudo -u jenkins -H minikube start --driver=docker --memory=2200 --cpus=2
sudo -u jenkins -H kubectl get nodes
```
Make it survive a reboot:
```bash
(crontab -l 2>/dev/null; echo '@reboot sleep 30 && sudo -u jenkins -H /usr/local/bin/minikube start') | sudo crontab -
```

### A6. Expose the app on the public IP
The Minikube node only has a private address, so forward the public port to it:
```bash
nohup sudo socat TCP-LISTEN:30080,fork,reuseaddr TCP:$(sudo -u jenkins -H minikube ip):30080 > /tmp/socat.log 2>&1 &
```
If you ever recreate Minikube, run this again (the IP may change).

## Part B. Put the code on GitHub
```bash
cd visiospark
git init && git add . && git commit -m "VisioSpark three-tier app"
git branch -M main
git remote add origin https://github.com/<you>/visiospark.git
git push -u origin main
```

## Part C. Jenkins pipeline
1. Jenkins -> New Item -> name `visiospark-pipeline` -> **Pipeline**.
2. Build Triggers: tick **GitHub hook trigger for GITScm polling**.
3. Pipeline: **Pipeline script from SCM** -> Git -> your repo URL -> branch `*/main` -> Script Path `Jenkinsfile`.
4. GitHub repo -> Settings -> Webhooks -> Add: `http://<server1-ip>:8080/github-webhook/`, content type `application/json`.
5. **Build Now**. Stages: Checkout, Test, Build images, Load into Minikube, Deploy to Kubernetes, Verify.
6. Open `http://<server1-ip>:30080`, register for an event.
7. Prove CI/CD: edit the title in `frontend/index.html`, commit and push. A build starts by itself and the page updates.

Useful checks on the server:
```bash
sudo -u jenkins -H kubectl -n visiospark get pods,svc,pvc
sudo -u jenkins -H kubectl -n visiospark logs deploy/backend
```

## Part D. Server 2 (Grafana monitoring)
1. Launch another instance (t3.small or similar). Security group: 22, 3000 (Grafana), 9090 (Prometheus).
2. In server 1's security group, allow 9100 from server 2.
3. Install Docker and copy the `monitoring/` folder:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker ubuntu   # then re-login
cd monitoring
sed -i 's/APP_SERVER_IP/<server1-private-or-public-ip>/g' prometheus.yml
docker compose up -d
```
4. Open `http://<server2-ip>:3000` (login admin / admin).
5. Connections -> Data sources -> Add **Prometheus** -> URL `http://prometheus:9090` -> Save & test.
6. Dashboards -> New -> Import -> ID **1860** (Node Exporter Full) -> choose the Prometheus data source. This shows server 1's CPU, memory and disk, so it connects to Task 1.
7. Connect to Jenkins itself (the link to Task 1): on Jenkins install the **Prometheus metrics** plugin, restart, then check `http://<server1-ip>:8080/prometheus/`. Import dashboard ID **9964** in Grafana. If Prometheus Status -> Targets shows `jenkins` as UP, Task 2 is linked to Task 1.

## Screenshot checklist for the Word document
1. EC2 instances (both) with type c7i-flex.large visible
2. Security group inbound rules
3. `java -version`, `docker --version`, `kubectl version --client`, `minikube version`
4. Jenkins service active (running) and Jenkins dashboard
5. `minikube status` and `kubectl get nodes`
6. GitHub repo with the files
7. Webhook with a green tick / recent delivery
8. Jenkins job configuration (pipeline from SCM)
9. Build with all stages green (Stage View) and the Console Output ending in SUCCESS
10. `kubectl -n visiospark get pods,svc` (all Running)
11. The app in the browser, with a registration added
12. A second commit that triggers a new build, and the changed page
13. Server 2: `docker ps`, Prometheus Targets page, Grafana data source, dashboard 1860 (and 9964)

## Troubleshooting
- `permission denied ... docker.sock`: `sudo usermod -aG docker jenkins && sudo systemctl restart jenkins`
- `minikube: command not found` in Jenkins: it must be in /usr/local/bin (see A4).
- Pods in `ImagePullBackOff`: the image was not loaded. Check the "Load into Minikube" stage, `minikube image ls`.
- Minikube not running after reboot: `sudo -u jenkins -H minikube start`, then rerun the socat command.
- Out of memory / Jenkins keeps dying: confirm swap with `free -h`.
