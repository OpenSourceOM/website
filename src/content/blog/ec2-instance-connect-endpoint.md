---
title: "EC2 Instance Connect Endpoint: Private SSH Without a Bastion"
description: "EC2 Instance Connect Endpoint is private SSH: OpenTunnel IAM, the endpoint security group as source, and when Session Manager is the better control."
pubDate: 2026-09-25
updatedDate: 2026-09-25
author: OpenSourceOM Team
tags:
  - AWS
  - EC2
  - Instance Connect
  - SSH
  - IAM
focusKeyword: EC2 Instance Connect Endpoint
faq:
  - question: Does an EC2 Instance Connect Endpoint need a public IP on the instance?
    answer: >-
      No. The instance can sit in a private subnet with no internet gateway
      route. Your client reaches the EC2 API, and the endpoint opens a
      tunnel to the instance’s private IP. The instance’s security group
      must allow SSH from the endpoint’s security group. It will never see
      your laptop’s public IP.
  - question: Is this better than Session Manager?
    answer: >-
      Use Session Manager when the SSM agent is installed. It needs no
      inbound port and no SSH daemon. Use an Instance Connect Endpoint
      when you truly need SSH or scp to a host that cannot run the agent.
      The endpoint is still an open port 22 from the endpoint ENI, gated
      by IAM. Do not deploy it as a second admin path “just in case” on
      every VPC.
  - question: Who can open the tunnel?
    answer: >-
      Any principal you allow ec2-instance-connect:OpenTunnel on, plus
      SendSSHPublicKey if you push a short-lived key. There is no separate
      network ACL for “the office.” If OpenTunnel is granted on * , every
      IAM user who can call the API can reach every instance the endpoint
      can route to. Scope the action to the endpoint and the instance, and
      pin remotePort to 22.
---

```bash
aws ec2 create-instance-connect-endpoint \
  --subnet-id subnet-0123456789abcdef0 \
  --security-group-ids sg-eice

aws ec2-instance-connect ssh \
  --instance-id i-0123456789abcdef0 \
  --connection-type eice \
  --os-user ec2-user
```

The first command is the **EC2 Instance Connect Endpoint**. The second is a client using it: IAM authenticates the tunnel, the endpoint connects to the instance on TCP 22, and a one-time SSH key is pushed for about a minute. No bastion, no public address on the instance. The service is documented in [EC2 Instance Connect Endpoint](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-using-eice.html).

Prefer Session Manager when the agent is present. This page is the path for hosts where SSH is actually required. It does not replace [IMDSv2 hop limit 1](/blog/aws-imdsv2-hop-limit-enforcement/); a shell on the box can still read metadata if the hop limit allows it.

## Security groups

The instance never sees your IP. Source is the endpoint ENI.

| Direction | Rule |
| --- | --- |
| Endpoint SG egress | TCP 22 to the instance SG |
| Instance SG ingress | TCP 22 from the endpoint SG |
| Instance SG ingress from `0.0.0.0/0` | Remove it. The endpoint does not use it |
| Endpoint SG ingress from the internet | Not how clients connect. Do not add it |

Put the endpoint in a private subnet that can route to the instances. One endpoint’s ENI is the source for every instance you allow. A wide instance SG (“the whole VPC on 22”) means any tunnel through this endpoint can reach those instances, and IAM is the only remaining gate.

Client IP preservation is not the control. Do not write a security group for the corporate NAT and expect EICE traffic to match it.

## IAM

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OpenTunnelToAppInstances",
      "Effect": "Allow",
      "Action": "ec2-instance-connect:OpenTunnel",
      "Resource": [
        "arn:aws:ec2:us-east-1:123456789012:instance-connect-endpoint/eice-0123456789abcdef0",
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0"
      ],
      "Condition": {
        "NumericEquals": { "ec2-instance-connect:remotePort": "22" }
      }
    },
    {
      "Sid": "PushShortLivedKey",
      "Effect": "Allow",
      "Action": "ec2-instance-connect:SendSSHPublicKey",
      "Resource": "arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0",
      "Condition": {
        "StringEquals": { "ec2:osuser": "ec2-user" }
      }
    }
  ]
}
```

`remotePort` 22 stops the same permission becoming RDP on 3389. `ec2:osuser` stops the key landing on `root` if the AMI allows it. `DescribeInstances` and `DescribeInstanceConnectEndpoints` are the read calls the CLI makes; they are not permission to connect.

`OpenTunnel` on `*` is a bastion for every VPC that has an endpoint. Grant it on the endpoint you created and the instances that group of people should reach. A break-glass role can be broader. The everyday permission set should not be.

CloudTrail records `OpenTunnel` and `SendSSHPublicKey`. Alert on `OpenTunnel` from a principal that is not the operations role, and on `CreateInstanceConnectEndpoint` outside the network account. An endpoint someone created in a public subnet with a wide instance SG is a new front door.

## When not to build it

| Situation | Use |
| --- | --- |
| SSM agent already running | Session Manager. No port 22 |
| You need a shell “for later” | Do not pre-create the endpoint |
| Vendor AMI, SSH only, no agent | EICE, scoped as above |
| Copying files off the host | Same IAM. scp rides the same tunnel. Still log it |

The SSH daemon has to be running and `AuthorizedKeysCommand` (Instance Connect) has to be installed on Amazon Linux and Ubuntu AMIs that support it. A hardened image that removed both will accept the tunnel and then reject the key. Test one instance before you delete the bastion.

Deleting the bastion without deleting its security group and its key pair is how the old path stays open. EICE is additive until you remove inbound 22 from `0.0.0.0/0` and retire the bastion role.

## Checklist

- [ ] Endpoint in a private subnet; instance has no public IP and no SSH from `0.0.0.0/0`
- [ ] Instance SG allows TCP 22 only from the endpoint SG
- [ ] `OpenTunnel` scoped to that endpoint and those instances, `remotePort` 22
- [ ] `SendSSHPublicKey` scoped to the instance and `ec2:osuser` is not root
- [ ] Session Manager used instead wherever the SSM agent runs
- [ ] CloudTrail alarm on `CreateInstanceConnectEndpoint` and unexpected `OpenTunnel`
- [ ] Hop limit on the instance is still 1

The endpoint removed the public address. IAM and the endpoint security group are the bastion now.
