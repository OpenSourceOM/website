// Copyright 2026 OpenSourceOM
// SPDX-License-Identifier: Apache-2.0

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function makeTopic(slug, title, focusKeyword, tags, description) {
  const desc =
    description ??
    `${title.split(':')[0]} — expert guide to ${focusKeyword} for AWS, Azure, GCP, and Kubernetes with CSPM, CNAPP, and attack path prioritization for practitioners.`;
  const trimmed = desc.length > 160 ? `${desc.slice(0, 157)}...` : desc;
  const padded =
    trimmed.length < 150 ? `${trimmed} For security and platform teams.` : trimmed;
  return [slug, title, padded.slice(0, 160), tags, focusKeyword];
}

/** @returns {[string, string, string, string[], string][]} */
export function buildTopicCatalog() {
  const topics = [];

  const aws = [
    ['EKS', 'Amazon EKS Security Hardening: Control Plane, Nodes, and IRSA'],
    ['ECS', 'Amazon ECS Security: Task Roles, Networking, and Fargate Hardening'],
    ['Fargate', 'AWS Fargate Security Best Practices for Container Workloads'],
    ['Lambda', 'AWS Lambda Security Deep Dive: Permissions, Layers, and URLs'],
    ['RDS', 'Amazon RDS Security: Encryption, IAM Auth, and Network Isolation'],
    ['Aurora', 'Amazon Aurora Security Guide for Production Databases'],
    ['DynamoDB', 'Amazon DynamoDB Security: IAM, Encryption, and Access Patterns'],
    ['ElastiCache', 'Amazon ElastiCache Security for Redis and Memcached'],
    ['Redshift', 'Amazon Redshift Security: Data Warehouse Access Controls'],
    ['OpenSearch', 'Amazon OpenSearch Service Security and Access Policies'],
    ['DocumentDB', 'Amazon DocumentDB Security Hardening Checklist'],
    ['MSK', 'Amazon MSK Security: Kafka Encryption and ACL Best Practices'],
    ['Kinesis', 'Amazon Kinesis Data Streams Security and IAM Policies'],
    ['Glue', 'AWS Glue Security for ETL Pipelines and Data Catalogs'],
    ['Athena', 'Amazon Athena Security: Query Access and S3 Data Controls'],
    ['SageMaker', 'Amazon SageMaker Security for ML Workloads in Production'],
    ['Bedrock', 'Amazon Bedrock Security: Guardrails, IAM, and Data Privacy'],
    ['Step Functions', 'AWS Step Functions Security and State Machine IAM'],
    ['EventBridge', 'Amazon EventBridge Security for Event-Driven Architectures'],
    ['SNS', 'Amazon SNS Security: Topics, Policies, and Encryption'],
    ['SQS', 'Amazon SQS Security: Queues, Policies, and Dead-Letter Handling'],
    ['API Gateway', 'Amazon API Gateway Security: Auth, Throttling, and WAF'],
    ['AppSync', 'AWS AppSync Security for GraphQL APIs in the Cloud'],
    ['Cognito', 'Amazon Cognito Security: User Pools, Identity Pools, and OAuth'],
    ['Secrets Manager', 'AWS Secrets Manager vs Parameter Store Security Patterns'],
    ['Systems Manager', 'AWS Systems Manager Security for Patch and Session Manager'],
    ['Inspector', 'Amazon Inspector for Vulnerability Management in AWS'],
    ['Macie', 'Amazon Macie for Sensitive Data Discovery in S3'],
    ['Security Hub', 'AWS Security Hub: Centralizing Findings and Compliance'],
    ['Config', 'AWS Config Rules for Continuous Compliance Monitoring'],
    ['Backup', 'AWS Backup Security: Vaults, Encryption, and Cross-Account'],
    ['CloudFront', 'Amazon CloudFront Security: TLS, OAC, and WAF Integration'],
    ['Route 53', 'Amazon Route 53 Security: DNS Hijacking Prevention'],
    ['ACM', 'AWS Certificate Manager Security and TLS Best Practices'],
    ['PrivateLink', 'AWS PrivateLink Security for Private Service Access'],
    ['Transit Gateway', 'AWS Transit Gateway Security and Segmentation Patterns'],
    ['Network Firewall', 'AWS Network Firewall Rules and Inspection Design'],
    ['Direct Connect', 'AWS Direct Connect Security and Encryption Options'],
    ['Site-to-Site VPN', 'AWS Site-to-Site VPN Security Configuration Guide'],
    ['CodePipeline', 'AWS CodePipeline Security for Secure CI/CD Delivery'],
    ['CodeBuild', 'AWS CodeBuild Security: Isolation, IAM, and Secrets'],
    ['CodeDeploy', 'AWS CodeDeploy Security for Blue-Green Deployments'],
    ['Amplify', 'AWS Amplify Security for Full-Stack Web Applications'],
    ['App Runner', 'AWS App Runner Security for Containerized Web Services'],
    ['Lightsail', 'Amazon Lightsail Security Basics for Small Cloud Workloads'],
  ];

  for (const [service, title] of aws) {
    const slug = slugify(`aws-${service}-security-guide`);
    const focus = `AWS ${service} security`;
    topics.push(
      makeTopic(slug, title, focus, ['AWS', service, 'cloud security', 'CSPM', 'CNAPP'], null)
    );
  }

  const azure = [
    ['AKS', 'Azure Kubernetes Service Security Hardening Guide'],
    ['ACR', 'Azure Container Registry Security and Image Scanning'],
    ['App Service', 'Azure App Service Security for Web Applications'],
    ['Functions', 'Azure Functions Security: Managed Identity and Networking'],
    ['Cosmos DB', 'Azure Cosmos DB Security: RBAC, Firewall, and Encryption'],
    ['SQL Managed Instance', 'Azure SQL Managed Instance Security Baseline'],
    ['PostgreSQL', 'Azure Database for PostgreSQL Security Hardening'],
    ['MySQL', 'Azure Database for MySQL Security Best Practices'],
    ['Redis', 'Azure Cache for Redis Security and Network Isolation'],
    ['Service Bus', 'Azure Service Bus Security: Auth and Network Rules'],
    ['Event Hubs', 'Azure Event Hubs Security for Streaming Data'],
    ['Synapse', 'Azure Synapse Analytics Security for Data Warehouses'],
    ['Data Lake', 'Azure Data Lake Storage Security and Access Control'],
    ['Machine Learning', 'Azure Machine Learning Security for MLOps Teams'],
    ['OpenAI Service', 'Azure OpenAI Service Security and Data Residency'],
    ['API Management', 'Azure API Management Security: OAuth and Rate Limits'],
    ['Front Door', 'Azure Front Door Security with WAF and Private Link'],
    ['CDN', 'Azure CDN Security: TLS, Origin Protection, and Rules'],
    ['Bastion', 'Azure Bastion Security for Secure RDP and SSH Access'],
    ['Firewall', 'Azure Firewall Policy Design for Cloud Networks'],
    ['DDoS Protection', 'Azure DDoS Protection Standard Configuration Guide'],
    ['Load Balancer', 'Azure Load Balancer Security and NSG Integration'],
    ['VPN Gateway', 'Azure VPN Gateway Security and Site-to-Site Setup'],
    ['ExpressRoute', 'Azure ExpressRoute Security and Private Connectivity'],
    ['Arc', 'Azure Arc Security for Hybrid and Multi-Cloud Servers'],
    ['Monitor', 'Azure Monitor Security Logging and Alert Rules'],
    ['Automation', 'Azure Automation Security for Runbooks and Updates'],
    ['Backup', 'Azure Backup Security: Vaults, Encryption, and RBAC'],
    ['Site Recovery', 'Azure Site Recovery Security for DR Workloads'],
    ['Purview', 'Microsoft Purview for Cloud Data Governance and DSPM'],
    ['Information Protection', 'Microsoft Information Protection in Azure Workloads'],
    ['DevOps', 'Azure DevOps Security: Pipelines, Repos, and Secrets'],
    ['Container Instances', 'Azure Container Instances Security Patterns'],
    ['Logic Apps', 'Azure Logic Apps Security for Workflow Automation'],
    ['Static Web Apps', 'Azure Static Web Apps Security and Auth Integration'],
    ['Communication Services', 'Azure Communication Services Security Guide'],
    ['Digital Twins', 'Azure Digital Twins Security for IoT Platforms'],
    ['IoT Hub', 'Azure IoT Hub Security: Device Identity and Monitoring'],
    ['SignalR', 'Azure SignalR Service Security and Access Keys'],
    ['Batch', 'Azure Batch Security for High-Performance Computing'],
  ];

  for (const [service, title] of azure) {
    const slug = slugify(`azure-${service}-security-guide`);
    const focus = `Azure ${service} security`;
    topics.push(
      makeTopic(slug, title, focus, ['Azure', service, 'cloud security', 'CSPM', 'CNAPP'], null)
    );
  }

  const gcp = [
    ['GKE', 'Google GKE Security Hardening for Production Clusters'],
    ['Cloud Run', 'Google Cloud Run Security: IAM, VPC, and Ingress Controls'],
    ['Cloud Functions', 'Google Cloud Functions Security Best Practices'],
    ['App Engine', 'Google App Engine Security for Legacy and New Apps'],
    ['BigQuery', 'Google BigQuery Security: IAM, Row Access, and Encryption'],
    ['Bigtable', 'Cloud Bigtable Security and Access Control Patterns'],
    ['Spanner', 'Google Cloud Spanner Security for Global Databases'],
    ['Firestore', 'Cloud Firestore Security Rules and IAM Guide'],
    ['Pub/Sub', 'Google Cloud Pub/Sub Security and Message Encryption'],
    ['Cloud Armor', 'Google Cloud Armor WAF Rules and DDoS Protection'],
    ['Identity-Aware Proxy', 'Google Identity-Aware Proxy for Zero Trust Access'],
    ['Certificate Manager', 'Google Certificate Manager TLS Security Guide'],
    ['Artifact Registry', 'Google Artifact Registry Security and Scanning'],
    ['Cloud Build', 'Google Cloud Build Security for CI/CD Pipelines'],
    ['Cloud Deploy', 'Google Cloud Deploy Security and Release Controls'],
    ['Dataflow', 'Google Cloud Dataflow Security for Streaming ETL'],
    ['Dataproc', 'Google Dataproc Security for Spark and Hadoop'],
    ['Vertex AI', 'Google Vertex AI Security for Enterprise ML Workloads'],
    ['AlloyDB', 'Google AlloyDB Security and High-Availability Design'],
    ['Memorystore', 'Google Memorystore Redis Security Configuration'],
    ['Filestore', 'Google Cloud Filestore Security and VPC Peering'],
    ['Cloud CDN', 'Google Cloud CDN Security and Origin Shielding'],
    ['Cloud Load Balancing', 'Google Cloud Load Balancing Security Architecture'],
    ['Cloud NAT', 'Google Cloud NAT Security for Egress Control'],
    ['Cloud VPN', 'Google Cloud VPN Security and HA Setup'],
    ['Cloud Interconnect', 'Google Cloud Interconnect Security Guide'],
    ['Binary Authorization', 'Google Binary Authorization for Supply Chain Security'],
    ['Cloud DNS', 'Google Cloud DNS Security and DNSSEC Configuration'],
    ['Secret Manager', 'Google Secret Manager Security and Rotation'],
    ['Cloud Logging', 'Google Cloud Logging Security and Retention Policies'],
    ['Error Reporting', 'Google Cloud Error Reporting Security Considerations'],
    ['Cloud Trace', 'Google Cloud Trace Security for Microservices'],
    ['Cloud Scheduler', 'Google Cloud Scheduler Security and IAM'],
    ['Cloud Tasks', 'Google Cloud Tasks Security for Async Workloads'],
    ['Apigee', 'Google Apigee API Security Management Guide'],
  ];

  for (const [service, title] of gcp) {
    const slug = slugify(`gcp-${service}-security-guide`);
    const focus = `GCP ${service} security`;
    topics.push(
      makeTopic(slug, title, focus, ['GCP', service, 'cloud security', 'CSPM', 'CNAPP'], null)
    );
  }

  const k8s = [
    ['Ingress Security', 'Kubernetes Ingress Security: TLS, Auth, and WAF'],
    ['Egress Control', 'Kubernetes Egress Control: Preventing Data Exfiltration'],
    ['Service Mesh mTLS', 'Kubernetes Service Mesh mTLS Security Patterns'],
    ['Helm Chart Security', 'Helm Chart Security Scanning and Best Practices'],
    ['GitOps Security', 'GitOps Security for Kubernetes: Argo CD and Flux'],
    ['Argo CD Hardening', 'Argo CD Security Hardening for Production GitOps'],
    ['Cilium Network', 'Cilium Network Security for Kubernetes Clusters'],
    ['Calico Policies', 'Calico Network Policies for Kubernetes Segmentation'],
    ['Falco Runtime', 'Falco Runtime Security for Kubernetes Threat Detection'],
    ['Trivy Scanning', 'Trivy Container Scanning in Kubernetes CI/CD'],
    ['Kyverno Policies', 'Kyverno Policy Engine Security for Kubernetes'],
    ['Gatekeeper OPA', 'OPA Gatekeeper Policies for Kubernetes Compliance'],
    ['External Secrets', 'External Secrets Operator Security in Kubernetes'],
    ['Cert Manager TLS', 'cert-manager TLS Security for Kubernetes Ingress'],
    ['Sealed Secrets', 'Sealed Secrets for GitOps Kubernetes Deployments'],
    ['etcd Encryption', 'Kubernetes etcd Encryption at Rest Configuration'],
    ['Control Plane Hardening', 'Kubernetes Control Plane Hardening Checklist'],
    ['Node Hardening', 'Kubernetes Worker Node Hardening for Production'],
    ['CIS Benchmark K8s', 'CIS Kubernetes Benchmark Implementation Guide'],
    ['Runtime Threat Detection', 'Kubernetes Runtime Threat Detection with eBPF'],
    ['Multi-Tenancy', 'Kubernetes Multi-Tenancy Security with Namespaces'],
    ['Cluster Autoscaler Security', 'Kubernetes Cluster Autoscaler Security Considerations'],
    ['CSI Driver Security', 'Kubernetes CSI Driver Security and Volume Encryption'],
    ['Persistent Volume Security', 'Kubernetes Persistent Volume Security Best Practices'],
    ['CronJob Security', 'Kubernetes CronJob Security and RBAC Scoping'],
  ];

  for (const [topic, title] of k8s) {
    const slug = slugify(`kubernetes-${topic}-guide`);
    const focus = `Kubernetes ${topic.toLowerCase()}`;
    topics.push(
      makeTopic(slug, title, focus, ['Kubernetes', 'container security', 'CNAPP', 'cloud security'], null)
    );
  }

  const compliance = [
    ['SOC 2 Type II', 'SOC 2 Type II Cloud Security Controls Checklist'],
    ['PCI DSS 4.0', 'PCI DSS 4.0 Cloud Compliance for Payment Workloads'],
    ['HIPAA', 'HIPAA Cloud Security Requirements for Healthcare Data'],
    ['ISO 27001', 'ISO 27001 Cloud Security Mapping for AWS and Azure'],
    ['NIST 800-53', 'NIST 800-53 Controls for Cloud Service Providers'],
    ['FedRAMP Moderate', 'FedRAMP Moderate Cloud Security Authorization Guide'],
    ['GDPR', 'GDPR Cloud Data Protection and Security Obligations'],
    ['CCPA', 'CCPA Cloud Privacy and Security for California Data'],
    ['SOX ITGC', 'SOX IT General Controls in Cloud Environments'],
    ['CMMC Level 2', 'CMMC Level 2 Cloud Security for Defense Contractors'],
    ['DORA', 'DORA Resilience Requirements for Cloud Financial Services'],
    ['NIS2 Directive', 'NIS2 Cloud Security Requirements for EU Operators'],
    ['CSA STAR', 'CSA STAR Cloud Security Assurance Framework Guide'],
    ['Cyber Essentials Plus', 'Cyber Essentials Plus for Cloud-Hosted UK Businesses'],
    ['Essential Eight', 'Essential Eight Cloud Security Maturity for Australian Orgs'],
    ['APRA CPS 234', 'APRA CPS 234 Cloud Security for Australian Finance'],
    ['MAS TRM', 'MAS TRM Cloud Technology Risk Management Guide'],
    ['FISMA Moderate', 'FISMA Moderate Cloud Controls for US Agencies'],
    ['IRAP', 'IRAP Cloud Security Assessment for Australian Government'],
    ['HITRUST', 'HITRUST CSF Cloud Security Certification Roadmap'],
  ];

  for (const [framework, title] of compliance) {
    const slug = slugify(`${framework}-cloud-security-compliance`);
    const focus = `${framework} cloud security`;
    topics.push(
      makeTopic(slug, title, focus, ['compliance', framework, 'cloud security', 'CSPM', 'audit'], null)
    );
  }

  const concepts = [
    ['External Attack Surface Management', 'External Attack Surface Management for Cloud Assets'],
    ['Cloud Security Maturity Model', 'Cloud Security Maturity Model: Stages and Metrics'],
    ['CNAPP Buyers Guide', 'CNAPP Buyers Guide: Evaluation Criteria for 2026'],
    ['Purple Team Cloud', 'Purple Team Exercises for Cloud Security Programs'],
    ['Threat Modeling Cloud', 'Threat Modeling for Cloud-Native Applications'],
    ['Security Chaos Engineering', 'Security Chaos Engineering in Cloud Environments'],
    ['FinOps Security', 'FinOps and Cloud Security: Cost Anomaly Detection'],
    ['Policy as Code Cloud', 'Policy as Code for Multi-Cloud Security Governance'],
    ['OPA Cloud Governance', 'Open Policy Agent for Cloud Security Policies'],
    ['Microservices Security', 'Microservices Security Patterns in the Cloud'],
    ['GraphQL API Security', 'GraphQL API Security in Cloud-Native Architectures'],
    ['Hybrid Cloud Security', 'Hybrid Cloud Security Architecture Best Practices'],
    ['Edge Cloud Security', 'Edge Cloud Security for CDN and IoT Gateways'],
    ['Confidential Computing', 'Confidential Computing in Public Cloud Platforms'],
    ['AI ML Security Cloud', 'AI and ML Security Risks in Cloud Workloads'],
    ['LLM Cloud Security', 'LLM Cloud Security: Prompt Injection and Data Leakage'],
    ['Cloud Penetration Testing', 'Cloud Penetration Testing Scope and Rules of Engagement'],
    ['Cloud Red Team', 'Cloud Red Team Operations: Tactics and Tooling'],
    ['Cloud Forensics', 'Cloud Forensics: Evidence Collection Across AWS and Azure'],
    ['MITRE ATT&CK Cloud', 'MITRE ATT&CK for Cloud: Mapping Detections to TTPs'],
    ['Ransomware Cloud Recovery', 'Ransomware Recovery Planning for Cloud Workloads'],
    ['Cryptomining Detection', 'Cryptomining Detection in Cloud Accounts'],
    ['Insider Threat Cloud', 'Insider Threat Detection in Cloud Control Planes'],
    ['OAuth Cloud Attacks', 'OAuth and OIDC Attack Patterns in Cloud Apps'],
    ['Third Party Cloud Access', 'Third-Party Cloud Access Risk Management'],
    ['Cloud Vendor Risk', 'Cloud Vendor Risk Assessment Framework'],
    ['MSSP Cloud Security', 'MSSP Cloud Security Service Design Patterns'],
    ['Security Architect Cloud', 'Cloud Security Architect Skills and Career Path'],
    ['CISO Cloud Strategy', 'CISO Cloud Security Strategy for Growing Startups'],
    ['Bug Bounty Cloud Scope', 'Bug Bounty Program Scope for Cloud Infrastructure'],
  ];

  for (const [topic, title] of concepts) {
    const slug = slugify(topic);
    const focus = topic.toLowerCase();
    topics.push(
      makeTopic(slug, title, focus, ['cloud security', 'CNAPP', 'CSPM', 'best practices'], null)
    );
  }

  const devsecops = [
    ['GitHub Actions Security', 'GitHub Actions Security for Cloud Deployment Pipelines'],
    ['GitLab CI Security', 'GitLab CI/CD Security Hardening for Cloud Teams'],
    ['Checkov IaC', 'Checkov IaC Scanning for Terraform and CloudFormation'],
    ['Tfsec Terraform', 'Tfsec Terraform Security Scanning in Pull Requests'],
    ['Cosign Signing', 'Cosign Container Image Signing for Supply Chain Trust'],
    ['SLSA Cloud', 'SLSA Supply Chain Levels for Cloud Build Pipelines'],
    ['Dependency Scanning', 'Dependency Scanning for Cloud Application Security'],
    ['License Compliance Cloud', 'Open Source License Compliance in Cloud Deployments'],
    ['Artifact Signing', 'Artifact Signing and Provenance for Cloud Releases'],
    ['Infrastructure Testing', 'Infrastructure Testing with Terratest and Policy Checks'],
    ['Shift Left Cloud', 'Shift Left Cloud Security in Agile Dev Teams'],
    ['DevSecOps Metrics', 'DevSecOps Metrics That Matter for Cloud Security'],
    ['Platform Engineering Security', 'Platform Engineering Security Guardrails for Developers'],
    ['Internal Developer Portal Security', 'Internal Developer Portal Security for Cloud Platforms'],
    ['Pulumi Security', 'Pulumi Infrastructure Security and Policy as Code'],
  ];

  for (const [topic, title] of devsecops) {
    const slug = slugify(`${topic}-cloud-guide`);
    const focus = topic.toLowerCase();
    topics.push(
      makeTopic(slug, title, focus, ['devsecops', 'cloud security', 'IaC', 'CI/CD'], null)
    );
  }

  // Deduplicate by slug
  const seen = new Set();
  return topics.filter(([slug]) => {
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}
