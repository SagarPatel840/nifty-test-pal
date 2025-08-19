import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, FileText, Settings, Zap } from "lucide-react";
import * as yaml from "js-yaml";

interface JMeterConfig {
  threadCount: number;
  rampUpTime: number;
  loopCount: number;
  baseUrl: string;
  testPlanName: string;
}

export const SwaggerToJMeter = () => {
  const [swaggerContent, setSwaggerContent] = useState("");
  const [jmeterXml, setJmeterXml] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState<JMeterConfig>({
    threadCount: 10,
    rampUpTime: 10,
    loopCount: 1,
    baseUrl: "",
    testPlanName: "API Performance Test"
  });
  const { toast } = useToast();

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      setSwaggerContent(content);
      
      // Try to extract base URL from swagger spec
      let parsedSpec;
      try {
        parsedSpec = file.name.endsWith('.yaml') || file.name.endsWith('.yml') 
          ? yaml.load(content) as any
          : JSON.parse(content);
        
        if (parsedSpec?.servers?.[0]?.url) {
          setConfig(prev => ({ ...prev, baseUrl: parsedSpec.servers[0].url }));
        } else if (parsedSpec?.host) {
          const scheme = parsedSpec.schemes?.[0] || 'https';
          setConfig(prev => ({ ...prev, baseUrl: `${scheme}://${parsedSpec.host}${parsedSpec.basePath || ''}` }));
        }
      } catch (e) {
        // If parsing fails, just use the content as-is
      }

      toast({
        title: "File uploaded successfully",
        description: `Loaded ${file.name}`,
      });
    } catch (error) {
      toast({
        title: "Error uploading file",
        description: "Please check your file format and try again.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const generateJMeterXml = (spec: any, config: JMeterConfig): string => {
    const timestamp = Date.now();
    
    // Parse base URL to extract domain, port, protocol
    const urlParts = (() => {
      try {
        const url = new URL(config.baseUrl);
        return {
          protocol: url.protocol.replace(':', ''),
          domain: url.hostname,
          port: url.port || (url.protocol === 'https:' ? '443' : '80'),
          path: url.pathname !== '/' ? url.pathname : ''
        };
      } catch {
        return {
          protocol: 'https',
          domain: config.baseUrl.replace(/^https?:\/\//, '').split('/')[0],
          port: '',
          path: ''
        };
      }
    })();
    
    // Extract paths and operations
    const operations: Array<{
      path: string;
      method: string;
      operationId?: string;
      summary?: string;
      parameters?: any[];
      requestBody?: any;
      tags?: string[];
    }> = [];

    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) {
          operations.push({
            path,
            method: method.toUpperCase(),
            operationId: (operation as any).operationId,
            summary: (operation as any).summary,
            parameters: (operation as any).parameters,
            requestBody: (operation as any).requestBody,
            tags: (operation as any).tags
          });
        }
      }
    }

    // Helper function to resolve $ref schemas
    const resolveSchema = (schema: any, spec: any): any => {
      if (schema.$ref) {
        const refPath = schema.$ref.replace('#/', '').split('/');
        let resolved = spec;
        for (const segment of refPath) {
          resolved = resolved?.[segment];
        }
        return resolved || {};
      }
      return schema;
    };

    // Helper function to generate request body for POST/PUT/DELETE requests
    const generateRequestBody = (requestBody: any): string => {
      if (!requestBody?.content) return '';
      
      const jsonContent = requestBody.content['application/json'];
      if (!jsonContent?.schema) return '';
      
      // Counter for generating unique IDs
      let idCounter = 1;
      
      // Generate sample JSON based on schema with realistic data
      const generateSampleJson = (schema: any, propertyName?: string): any => {
        // Resolve $ref if present
        const resolvedSchema = resolveSchema(schema, spec);
        
        // Check for example value first
        if (resolvedSchema.example !== undefined) {
          return resolvedSchema.example;
        }
        
        // Check for examples array
        if (resolvedSchema.examples && Array.isArray(resolvedSchema.examples) && resolvedSchema.examples.length > 0) {
          return resolvedSchema.examples[0];
        }
        
        switch (resolvedSchema.type) {
          case 'object':
            const obj: any = {};
            if (resolvedSchema.properties) {
              for (const [key, prop] of Object.entries(resolvedSchema.properties)) {
                obj[key] = generateSampleJson(prop as any, key);
              }
            }
            return obj;
            
          case 'array':
            if (resolvedSchema.items) {
              return [generateSampleJson(resolvedSchema.items)];
            }
            return [];
            
          case 'string':
            // Generate more realistic string values based on property names
            if (propertyName) {
              const lowerName = propertyName.toLowerCase();
              if (lowerName.includes('id')) return String(idCounter++);
              if (lowerName.includes('name')) return `sample${propertyName.charAt(0).toUpperCase() + propertyName.slice(1)}`;
              if (lowerName.includes('email')) return 'sample@example.com';
              if (lowerName.includes('url') || lowerName.includes('link')) return 'https://example.com';
              if (lowerName.includes('phone')) return '+1234567890';
              if (lowerName.includes('address')) return '123 Sample St';
              if (lowerName.includes('city')) return 'Sample City';
              if (lowerName.includes('country')) return 'Sample Country';
              if (lowerName.includes('description') || lowerName.includes('comment')) return 'Sample description';
              if (lowerName.includes('status')) return 'active';
              if (lowerName.includes('type') || lowerName.includes('category')) return 'sample';
            }
            
            // Check enum values
            if (resolvedSchema.enum && resolvedSchema.enum.length > 0) {
              return resolvedSchema.enum[0];
            }
            
            return 'sample';
            
          case 'integer':
            // Generate realistic integers based on property names
            if (propertyName) {
              const lowerName = propertyName.toLowerCase();
              if (lowerName.includes('id')) return idCounter++;
              if (lowerName.includes('count') || lowerName.includes('quantity')) return 5;
              if (lowerName.includes('age')) return 25;
              if (lowerName.includes('year')) return new Date().getFullYear();
              if (lowerName.includes('month')) return Math.floor(Math.random() * 12) + 1;
              if (lowerName.includes('day')) return Math.floor(Math.random() * 28) + 1;
              if (lowerName.includes('price') || lowerName.includes('amount')) return 100;
            }
            
            // Check for minimum/maximum constraints
            if (resolvedSchema.minimum !== undefined) {
              return Math.max(resolvedSchema.minimum, 1);
            }
            if (resolvedSchema.maximum !== undefined) {
              return Math.min(resolvedSchema.maximum, 100);
            }
            
            return 1;
            
          case 'number':
            // Similar logic for numbers but with decimals
            if (propertyName) {
              const lowerName = propertyName.toLowerCase();
              if (lowerName.includes('price') || lowerName.includes('amount') || lowerName.includes('cost')) return 99.99;
              if (lowerName.includes('rate') || lowerName.includes('percentage')) return 0.15;
              if (lowerName.includes('weight')) return 1.5;
              if (lowerName.includes('height')) return 1.75;
            }
            
            if (resolvedSchema.minimum !== undefined) {
              return Math.max(resolvedSchema.minimum, 1.0);
            }
            if (resolvedSchema.maximum !== undefined) {
              return Math.min(resolvedSchema.maximum, 100.0);
            }
            
            return 1.0;
            
          case 'boolean':
            if (propertyName) {
              const lowerName = propertyName.toLowerCase();
              if (lowerName.includes('active') || lowerName.includes('enabled') || lowerName.includes('available')) return true;
              if (lowerName.includes('deleted') || lowerName.includes('disabled') || lowerName.includes('hidden')) return false;
            }
            return true;
            
          default:
            return null;
        }
      };
      
      const sampleData = generateSampleJson(jsonContent.schema);
      return JSON.stringify(sampleData, null, 2);
    };

    // Generate HTTP samplers
    const httpSamplers = operations.map((op, index) => {
      const samplerName = op.operationId || op.summary || `${op.method} ${op.path}`;
      const pathWithoutParams = op.path.replace(/{([^}]+)}/g, '${$1}');
      const needsBody = ['POST', 'PUT', 'PATCH'].includes(op.method);
      const requestBody = needsBody ? generateRequestBody(op.requestBody) : '';
      
      const bodyDataProp = requestBody ? `
          <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                <boolProp name="HTTPArgument.always_encode">false</boolProp>
                <stringProp name="Argument.value">${requestBody.replace(/"/g, '&quot;')}</stringProp>
                <stringProp name="Argument.metadata">=</stringProp>
              </elementProp>
            </collectionProp>
          </elementProp>` : `
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>`;
      
      return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${samplerName}" enabled="true">
          ${bodyDataProp}
          <stringProp name="HTTPSampler.domain">${urlParts.domain}</stringProp>
          <stringProp name="HTTPSampler.port">${urlParts.port}</stringProp>
          <stringProp name="HTTPSampler.protocol">${urlParts.protocol}</stringProp>
          <stringProp name="HTTPSampler.contentEncoding">UTF-8</stringProp>
          <stringProp name="HTTPSampler.path">${urlParts.path}${pathWithoutParams}</stringProp>
          <stringProp name="HTTPSampler.method">${op.method}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.auto_redirects">false</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
          <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
          <stringProp name="HTTPSampler.embedded_url_re"></stringProp>
          <stringProp name="HTTPSampler.connect_timeout">60000</stringProp>
          <stringProp name="HTTPSampler.response_timeout">60000</stringProp>
        </HTTPSamplerProxy>
        <hashTree/>`;
    }).join('\n');

    // Group operations by tags
    const tagGroups = new Map<string, typeof operations>();
    operations.forEach(op => {
      const tag = op.tags?.[0] || 'Default';
      if (!tagGroups.has(tag)) {
        tagGroups.set(tag, []);
      }
      tagGroups.get(tag)!.push(op);
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.4.1">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${config.testPlanName}" enabled="true">
      <stringProp name="TestPlan.comments">Generated from OpenAPI/Swagger specification</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.tearDown_on_shutdown">true</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.arguments" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
        <collectionProp name="Arguments.arguments">
          <elementProp name="BASE_URL" elementType="Argument">
            <stringProp name="Argument.name">BASE_URL</stringProp>
            <stringProp name="Argument.value">${config.baseUrl}</stringProp>
            <stringProp name="Argument.metadata">=</stringProp>
          </elementProp>
        </collectionProp>
      </elementProp>
      <stringProp name="TestPlan.user_define_classpath"></stringProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="API Thread Group" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">${config.loopCount}</stringProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${config.threadCount}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${config.rampUpTime}</stringProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
        <stringProp name="ThreadGroup.delay"></stringProp>
        <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
      </ThreadGroup>
      <hashTree>
        <ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="HTTP Request Defaults" enabled="true">
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>
          <stringProp name="HTTPSampler.domain"></stringProp>
          <stringProp name="HTTPSampler.port"></stringProp>
          <stringProp name="HTTPSampler.protocol"></stringProp>
          <stringProp name="HTTPSampler.contentEncoding">UTF-8</stringProp>
          <stringProp name="HTTPSampler.path"></stringProp>
          <stringProp name="HTTPSampler.concurrentPool">6</stringProp>
          <stringProp name="HTTPSampler.connect_timeout">60000</stringProp>
          <stringProp name="HTTPSampler.response_timeout">60000</stringProp>
        </ConfigTestElement>
        <hashTree/>
        
        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Header Manager" enabled="true">
          <collectionProp name="HeaderManager.headers">
            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">Content-Type</stringProp>
              <stringProp name="Header.value">application/json</stringProp>
            </elementProp>
            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">Accept</stringProp>
              <stringProp name="Header.value">application/json</stringProp>
            </elementProp>
            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">User-Agent</stringProp>
              <stringProp name="Header.value">JMeter Performance Test</stringProp>
            </elementProp>
          </collectionProp>
        </HeaderManager>
        <hashTree/>

        ${httpSamplers}

        <ResultCollector guiclass="ViewResultsFullVisualizer" testclass="ResultCollector" testname="View Results Tree" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>true</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>true</threadName>
              <dataType>true</dataType>
              <encoding>false</encoding>
              <assertions>true</assertions>
              <subresults>true</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>true</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>true</bytes>
              <sentBytes>true</sentBytes>
              <url>true</url>
              <threadCounts>true</threadCounts>
              <idleTime>true</idleTime>
              <connectTime>true</connectTime>
            </value>
          </objProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>
        
        <ResultCollector guiclass="SummaryReport" testclass="ResultCollector" testname="Summary Report" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>true</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>true</threadName>
              <dataType>true</dataType>
              <encoding>false</encoding>
              <assertions>true</assertions>
              <subresults>true</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>true</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>true</bytes>
              <sentBytes>true</sentBytes>
              <url>true</url>
              <threadCounts>true</threadCounts>
              <idleTime>true</idleTime>
              <connectTime>true</connectTime>
            </value>
          </objProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;
  };

  const handleGenerateJMeter = async () => {
    if (!swaggerContent.trim()) {
      toast({
        title: "No Swagger specification",
        description: "Please upload a Swagger/OpenAPI file first.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Parse swagger/openapi spec
      let spec;
      try {
        spec = JSON.parse(swaggerContent);
      } catch {
        try {
          spec = yaml.load(swaggerContent);
        } catch (yamlError) {
          throw new Error("Invalid JSON or YAML format");
        }
      }

      // Basic validation - check if it looks like an OpenAPI/Swagger spec
      if (!spec || typeof spec !== 'object') {
        throw new Error("Invalid specification format");
      }
      
      if (!spec.openapi && !spec.swagger) {
        throw new Error("Not a valid OpenAPI/Swagger specification. Missing 'openapi' or 'swagger' field.");
      }
      
      if (!spec.paths || typeof spec.paths !== 'object') {
        throw new Error("No paths found in the specification");
      }
      
      // Generate JMeter XML
      const xml = generateJMeterXml(spec, config);
      setJmeterXml(xml);

      toast({
        title: "JMeter file generated successfully",
        description: "You can now download the JMX file.",
      });
    } catch (error) {
      console.error('Error generating JMeter file:', error);
      toast({
        title: "Error generating JMeter file",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!jmeterXml) return;

    const blob = new Blob([jmeterXml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.testPlanName.replace(/\s+/g, '_')}.jmx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
          Swagger to JMeter Converter
        </h1>
        <p className="text-muted-foreground mt-2">
          Upload your OpenAPI/Swagger specification to generate a ready-to-execute JMeter test plan
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Test Configuration
            </CardTitle>
            <CardDescription>
              Configure your JMeter test parameters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="testPlanName">Test Plan Name</Label>
              <Input
                id="testPlanName"
                value={config.testPlanName}
                onChange={(e) => setConfig(prev => ({ ...prev, testPlanName: e.target.value }))}
                placeholder="API Performance Test"
              />
            </div>
            
            <div>
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value={config.baseUrl}
                onChange={(e) => setConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://api.example.com"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="threadCount">Threads</Label>
                <Input
                  id="threadCount"
                  type="number"
                  min="1"
                  value={config.threadCount}
                  onChange={(e) => setConfig(prev => ({ ...prev, threadCount: parseInt(e.target.value) || 1 }))}
                />
              </div>
              
              <div>
                <Label htmlFor="rampUpTime">Ramp-up (s)</Label>
                <Input
                  id="rampUpTime"
                  type="number"
                  min="1"
                  value={config.rampUpTime}
                  onChange={(e) => setConfig(prev => ({ ...prev, rampUpTime: parseInt(e.target.value) || 1 }))}
                />
              </div>
              
              <div>
                <Label htmlFor="loopCount">Loops</Label>
                <Input
                  id="loopCount"
                  type="number"
                  min="1"
                  value={config.loopCount}
                  onChange={(e) => setConfig(prev => ({ ...prev, loopCount: parseInt(e.target.value) || 1 }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Swagger/OpenAPI
            </CardTitle>
            <CardDescription>
              Upload your API specification file (JSON or YAML format)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="swaggerFile">Choose File</Label>
              <Input
                id="swaggerFile"
                type="file"
                accept=".json,.yaml,.yml"
                onChange={handleFileUpload}
                className="cursor-pointer"
              />
            </div>
            
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Or paste your specification directly:
              </p>
              <Textarea
                placeholder="Paste your OpenAPI/Swagger specification here..."
                value={swaggerContent}
                onChange={(e) => setSwaggerContent(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-4 justify-center">
        <Button 
          onClick={handleGenerateJMeter}
          disabled={!swaggerContent.trim() || isProcessing}
          size="lg"
          className="min-w-[200px]"
        >
          <Zap className="mr-2 h-4 w-4" />
          {isProcessing ? "Generating..." : "Generate JMeter File"}
        </Button>
        
        {jmeterXml && (
          <Button 
            onClick={handleDownload}
            variant="gradient"
            size="lg"
            className="min-w-[200px]"
          >
            <Download className="mr-2 h-4 w-4" />
            Download JMX File
          </Button>
        )}
      </div>

      {/* Preview */}
      {jmeterXml && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Generated JMeter XML Preview
            </CardTitle>
            <CardDescription>
              Preview of the generated JMX file content
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={jmeterXml}
              readOnly
              rows={20}
              className="font-mono text-xs"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};