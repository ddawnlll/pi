#!/usr/bin/env node
/**
 * Convert P44 PlanSpec to PlanSpec v5 Alpha2 format
 * 
 * This script transforms the P44-style plan into the PlanSpec v5 alpha2 template structure
 * by adding missing fields and restructuring workspaces to match the schema.
 */

const fs = require('fs');
const path = require('path');

// Read input files
const p44File = JSON.parse(fs.readFileSync('/Users/hootie/src/pi/docs/P44_PlanSpec_v5_single_file_final.json', 'utf8'));
const template = JSON.parse(fs.readFileSync('/Users/hootie/src/pi/PlanSpec_v5_alpha2_template_pack/01_planspec_v5_alpha2_template.example.json', 'utf8'));

console.log('Converting P44 PlanSpec to PlanSpec v5 Alpha2 format...\n');

// Start with the P44 file as base
const converted = { ...p44File };

// 1. Update schema reference
converted.$schema = './02_planspec_v5_alpha2_schema.json';

// 2. Ensure planSpecVersion is correct (already should be)
if (!converted.planSpecVersion || converted.planSpecVersion !== '5.0.0-alpha2') {
  console.log('Updating planSpecVersion to 5.0.0-alpha2');
  converted.planSpecVersion = '5.0.0-alpha2';
}

// 3. Add metadata.sourceDocument if missing
if (!converted.metadata) {
  converted.metadata = {};
}
converted.metadata.sourceDocument = converted.metadata.sourceDocument || 'P44_PlanSpec_v5_single_file_final.json';
converted.metadata.updatedAt = new Date().toISOString();

// 4. Ensure compatibility section exists
if (!converted.compatibility) {
  converted.compatibility = {
    runtimeContractVersion: '4.1.1',
    runtimeTemplateVersion: '4.1.1',
    legacyTemplateCompatible: true,
    generatedFromV411: true,
    v411AdapterRequired: true,
    notes: ['Converted from P44 format to PlanSpec v5 alpha2']
  };
}

// 5. Ensure intent section has required fields
if (!converted.intent) {
  converted.intent = {};
}
if (!converted.intent.executionClass) {
  converted.intent.executionClass = 'implementation';
}
if (!converted.intent.safetyLevel) {
  converted.intent.safetyLevel = 'strict';
}
if (!converted.intent.executionMode) {
  converted.intent.executionMode = 'stable_3_wave_batch';
}

// 6. Ensure authority has completion and repositoryMutation sections
if (!converted.authority) {
  converted.authority = {};
}
if (!converted.authority.completion) {
  converted.authority.completion = {
    workerSelfReportIsClaimOnly: true,
    completionGate: 'CompletionGateV2',
    evidenceLedgerRequired: true,
    missingEvidenceBlocksCompletion: true,
    staleAttemptVerdictIgnored: true
  };
}
if (!converted.authority.repositoryMutation) {
  converted.authority.repositoryMutation = {
    writeGateRequired: true,
    workspaceCommitGateRequired: true,
    allowedFilesRequired: true,
    largeOverwriteBlockedByDefault: true
  };
}
if (!converted.authority.reports) {
  converted.authority.reports = {
    protocol: 'ACCP',
    version: '1.2.0',
    reportsAreEvidenceOnly: true,
    reportsDoNotAuthorizeExecution: true
  };
}

// 7. Ensure enforcementRegistry exists
if (!converted.enforcementRegistry) {
  converted.enforcementRegistry = {
    mechanisms: [
      'json_schema',
      'admission_gate',
      'plan_lock_verifier',
      'workspace_lock_verifier',
      'tool_runtime',
      'command_policy_engine',
      'runtime_command_grant',
      'write_gate',
      'smart_mutation_engine',
      'workspace_commit_gate',
      'completion_gate_v2',
      'terminal_reconciler',
      'evidence_ledger',
      'accp_report_validator',
      'final_promotion_gate',
      'p45_bridge_boundary_guard'
    ]
  };
}

// 8. Ensure security section has required fields
if (!converted.security) {
  converted.security = {};
}
if (!converted.security.forbiddenFiles) {
  converted.security.forbiddenFiles = [
    '.env',
    '.env.*',
    'node_modules/**',
    '.git/**',
    'package-lock.json',
    'pnpm-lock.yaml',
    'packages/coding-agent/src/p45/**',
    'packages/coding-agent/src/async-assembly/**',
    'packages/coding-agent/src/static-partitioner/**',
    'packages/coding-agent/src/deterministic-assembler/**'
  ];
}

// 9. Convert workspaces to PlanSpec v5 alpha2 format
console.log('Converting', converted.workspaces?.length || 0, 'workspaces...');
if (converted.workspaces && Array.isArray(converted.workspaces)) {
  converted.workspaces = converted.workspaces.map((ws, index) => {
    const convertedWs = { ...ws };
    
    // Ensure acceptance criteria have description field
    if (convertedWs.acceptanceCriteria && Array.isArray(convertedWs.acceptanceCriteria)) {
      convertedWs.acceptanceCriteria = convertedWs.acceptanceCriteria.map(ac => {
        // If AC has text/title but no description, use text or title
        if (!ac.description && (ac.text || ac.title)) {
          return {
            ...ac,
            description: ac.text || ac.title || ac.description
          };
        }
        return ac;
      });
    }
    
    // Ensure validation has required fields
    if (!convertedWs.validation) {
      convertedWs.validation = {};
    }
    if (!convertedWs.validation.commandRefs) {
      convertedWs.validation.commandRefs = [];
    }
    if (convertedWs.validation.watchModeRejected === undefined) {
      convertedWs.validation.watchModeRejected = true;
    }
    if (convertedWs.validation.mustPass === undefined) {
      convertedWs.validation.mustPass = true;
    }
    if (convertedWs.validation.requireEvidence === undefined) {
      convertedWs.validation.requireEvidence = true;
    }
    
    // Convert reports from object to array if needed
    if (convertedWs.reports && typeof convertedWs.reports === 'object' && !Array.isArray(convertedWs.reports)) {
      // Keep as-is for now, schema will validate
    } else if (!convertedWs.reports) {
      convertedWs.reports = [];
    }
    
    // Ensure rollback has steps array
    if (!convertedWs.rollback) {
      convertedWs.rollback = { steps: [] };
    } else if (!convertedWs.rollback.steps) {
      convertedWs.rollback.steps = [];
    }
    
    // Ensure commands is an array
    if (!convertedWs.commands) {
      convertedWs.commands = [];
    }
    
    return convertedWs;
  });
}

// 10. Add waves if missing (derive from workstreams or create default)
if (!converted.waves || !Array.isArray(converted.waves)) {
  console.log('Creating waves from workstreams...');
  converted.waves = [];
  
  if (converted.workstreams && Array.isArray(converted.workstreams)) {
    converted.waves = converted.workstreams.map(ws => ({
      id: ws.id,
      description: ws.description || ws.title || '',
      workspaceRefs: ws.workspaceRefs || ws.workspaces || [],
      parallel: ws.parallel || false
    }));
  } else if (converted.workspaces && Array.isArray(converted.workspaces)) {
    // Create a single wave with all workspaces
    converted.waves = [{
      id: 'WAVE-01',
      description: 'All workspaces',
      workspaceRefs: converted.workspaces.map(ws => ws.id),
      parallel: false
    }];
  }
}

// 11. Add templates if missing
if (!converted.templates) {
  converted.templates = [];
}

// 12. Add validationCases if missing
if (!converted.validationCases) {
  converted.validationCases = [];
  
  // Try to extract from validation section if it exists
  if (converted.validation && Array.isArray(converted.validation.cases)) {
    converted.validationCases = converted.validation.cases.map(vc => ({
      id: vc.id,
      description: vc.description,
      input: vc.input || vc.command || '',
      expected: vc.expected || { valid: true }
    }));
  }
}

// 13. Ensure locking section has required fields
if (!converted.locking) {
  converted.locking = {};
}
if (!converted.locking.type) {
  converted.locking.type = 'plan_and_workspace';
}
if (!converted.locking.description) {
  converted.locking.description = 'Plan and workspace locks for integrity verification';
}

// Write output
const outputPath = '/Users/hootie/src/pi/docs/P44_PlanSpec_v5_alpha2_converted.json';
fs.writeFileSync(outputPath, JSON.stringify(converted, null, 2), 'utf8');

console.log('\n✓ Conversion complete!');
console.log('Output:', outputPath);
console.log('\nNext steps:');
console.log('1. Validate the converted file against the schema');
console.log('2. Test with the server validate endpoint');
console.log('3. Fix any remaining schema validation errors');
