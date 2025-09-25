#!/bin/bash

# Function to check if the system is running on EC2
is_ec2_instance() {
    # Query the EC2 metadata service
    if curl -s --connect-timeout 1 http://169.254.169.254/latest/meta-data/ > /dev/null; then
        return 0  # EC2 instance detected
    else
        return 1  # Not an EC2 instance
    fi
}

# Run only if on an EC2 instance
if is_ec2_instance; then
    echo "Running on an EC2 instance."

    # Check if pdftoppm is already installed
    if ! command -v pdftoppm &> /dev/null; then
        echo "pdftoppm could not be found. Installing poppler-utils..."
        # Install poppler-utils (this works on Amazon Linux using yum)
        sudo yum install -y poppler-utils
    else
        echo "pdftoppm is already installed."
    fi
else
    echo "This script is only meant to run on EC2 instances. Exiting."
    # Do not exit with error
    # exit 1
fi
