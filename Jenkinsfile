pipeline {
    agent any

    environment {
        TAG = "${BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Test') {
            steps { sh 'cd backend && npm install && npm test' }
        }

        stage('Build images') {
            steps {
                sh 'docker build -t visiospark-backend:$TAG backend'
                sh 'docker build -t visiospark-frontend:$TAG frontend'
            }
        }

        stage('Load into Minikube') {
            steps {
                sh 'minikube image load visiospark-backend:$TAG'
                sh 'minikube image load visiospark-frontend:$TAG'
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                  for f in k8s/*.yaml; do
                    sed "s/IMAGE_TAG/$TAG/g" "$f" | kubectl apply -f -
                  done
                  kubectl -n visiospark rollout status deployment/db --timeout=180s
                  kubectl -n visiospark rollout status deployment/backend --timeout=180s
                  kubectl -n visiospark rollout status deployment/frontend --timeout=180s
                '''
            }
        }

        stage('Verify') {
            steps {
                sh '''
                  kubectl -n visiospark get pods,svc
                  for i in $(seq 1 20); do
                    if curl -fs http://$(minikube ip):30080/api/health; then exit 0; fi
                    sleep 3
                  done
                  echo "App did not respond"; exit 1
                '''
            }
        }
    }

    post {
        failure { sh 'kubectl -n visiospark get pods || true' }
        always  { sh 'docker image prune -f || true' }
    }
}
