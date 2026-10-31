<?xml version="1.0"?>
<!-- Sign Tools for CorelDRAW: ใส่ "Sign Tools" ไว้ท้ายเมนู Window › Dockers -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:frmwrk="Corel Framework Data" exclude-result-prefixes="frmwrk">
  <xsl:output method="xml" encoding="UTF-8" indent="yes"/>
  <frmwrk:uiconfig>
    <frmwrk:compositeNode xPath="/uiConfig/commandBars/commandBarData[@guid='3eaa9bbe-28fd-4672-9128-02974ee96332']"/>
    <frmwrk:compositeNode xPath="/uiConfig/frame"/>
  </frmwrk:uiconfig>
  <xsl:template match="node()|@*">
    <xsl:copy><xsl:apply-templates select="node()|@*"/></xsl:copy>
  </xsl:template>
  <xsl:template match="commandBarData[@guid='3eaa9bbe-28fd-4672-9128-02974ee96332']/menu">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
      <xsl:if test="not(./item[@guidRef='3c66267b-c422-41ce-bb34-9b5eb5ab584d'])">
        <item guidRef="3c66267b-c422-41ce-bb34-9b5eb5ab584d"/>
      </xsl:if>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
